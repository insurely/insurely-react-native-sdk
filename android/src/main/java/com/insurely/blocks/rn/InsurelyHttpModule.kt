// Copyright © 2026 Insurely AB. All rights reserved.

package com.insurely.blocks.rn

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Performs a single bank-endpoint request on behalf of the Blocks web app.
 *
 * Blocks hands the SDK an HTTP request in a COLLECTION_STATUS message and
 * expects the response posted back into the WebView. Three things about that
 * request are load-bearing and are why this is native rather than `fetch`:
 *
 * 1. the cookie jar is scoped to this one call, so bank session cookies never
 *    mix with the app's cookies in either direction;
 * 2. response headers are collected across the *whole* redirect chain, not just
 *    the last hop;
 * 3. `Set-Cookie` is never written into `headers`, and `setCookie` reflects the
 *    cookie jar's state at the end of the redirect chain — one entry per cookie
 *    identity, so a cookie a bank re-sets mid-chain (rotating a session id on a
 *    redirect) is reported once, as its current value, not once per hop.
 *
 * Getting any of these wrong produces a collection that fails intermittently at
 * one bank, which is close to undebuggable from the outside.
 */
class InsurelyHttpModule(reactContext: ReactApplicationContext) :
  NativeInsurelyHttpSpec(reactContext) {

  /**
   * Codegen signature: `public abstract void execute(ReadableMap request, Promise promise)`.
   *
   * `request` is a JSI-backed map whose lifetime ends when this method returns,
   * so every field is read out synchronously here; nothing below the parse step
   * touches it again. (This is the Android counterpart of the iOS
   * `RCTManagedPointer` lifetime constraint.)
   */
  override fun execute(request: ReadableMap, promise: Promise) {
    // Everything below `enqueue` is synchronous and reads the JSI-backed
    // `request` map (headers are validated and copied here, cookies are built,
    // the client is assembled). None of that is guarded by OkHttp's own
    // `Callback` machinery, so it is wrapped here: `Headers.Builder` throws
    // `IllegalArgumentException` on a header name or value with control
    // characters, and that header text comes from Blocks and, indirectly, from
    // a bank. Left unwrapped, that throw would escape `execute()` instead of
    // rejecting `promise`, and the collection would hang forever with no error
    // surfaced anywhere. Every path below settles `promise` exactly once and
    // then returns, so this catch can never fire after a resolve/reject has
    // already happened.
    try {
      val url = request.getString("url")?.toHttpUrlOrNull()
      if (url == null) {
        promise.reject("invalid_url", "Instruction request has an invalid URL")
        return
      }

      val method = request.getString("method")
        ?.takeIf { it.isNotEmpty() }
        ?.uppercase()
        ?: "GET"

      val builder = Request.Builder().url(url)
      request.getMap("headers")?.let { headers ->
        val iterator = headers.keySetIterator()
        while (iterator.hasNextKey()) {
          val name = iterator.nextKey()
          val value = headers.getString(name) ?: continue
          builder.addHeader(name, value)
        }
      }
      builder.method(method, requestBody(method, request.getString("body")))

      // (1) A cookie jar that exists only for this call. It is seeded with the
      // cookies Blocks handed us, accumulates whatever the bank sets on every hop
      // of the redirect chain, and is discarded with the call. It is not the app's
      // jar and it is not shared with any other instruction request.
      val jar = InstructionCookieJar(seedCookies(request, url))

      // `newBuilder()` shares the dispatcher and connection pool with the shared
      // client (per OkHttp's own guidance) but takes a fresh cookie jar. Cookies
      // are the isolated resource; threads and sockets are not.
      val client = sharedClient.newBuilder().cookieJar(jar).build()

      client.newCall(builder.build()).enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
          promise.reject("request_failed", e.message ?: "Instruction request failed", e)
        }

        override fun onResponse(call: Call, response: Response) {
          try {
            response.use { promise.resolve(resultOf(it, jar)) }
          } catch (error: Exception) {
            promise.reject("request_failed", error.message ?: "Instruction request failed", error)
          }
        }
      })
    } catch (error: Exception) {
      promise.reject("invalid_request", error.message ?: "Instruction request is invalid", error)
      return
    }
  }

  private fun resultOf(response: Response, jar: InstructionCookieJar): WritableMap {
    // (2) OkHttp follows redirects internally and exposes each hop through
    // `priorResponse`. That chain is walked oldest-first so headers set on an
    // intermediate hop survive into the result in the order the bank sent them,
    // with the final response last. Reading only `response.headers` would lose
    // every `Location`, `Set-Cookie` and vendor header set before the last hop.
    val chain = ArrayList<Response>()
    var prior = response.priorResponse
    while (prior != null) {
      chain.add(prior)
      prior = prior.priorResponse
    }
    chain.reverse()
    chain.add(response)

    // Keyed by lower-cased name so hops that disagree about casing ("Location"
    // vs "location") merge into one entry instead of two JS object keys where
    // one silently wins; the first spelling seen is the one reported.
    val values = LinkedHashMap<String, MutableList<String>>()
    val names = LinkedHashMap<String, String>()

    for (candidate in chain) {
      // (3) `Headers` is an ordered list of name/value pairs, not a map, so
      // repeated headers stay repeated. `Set-Cookie` is still excluded from
      // `headers` here, but its values are no longer collected from this raw
      // header text — see `setCookie` below, which is sourced from the cookie
      // jar instead so a cookie re-set on a later hop is reported once, not
      // once per hop.
      for ((name, value) in candidate.headers) {
        if (name.equals(SET_COOKIE, ignoreCase = true)) {
          continue
        }
        val key = name.lowercase()
        names.getOrPut(key) { name }
        values.getOrPut(key) { ArrayList() }.add(value)
      }
    }

    val headers = Arguments.createMap()
    for ((key, list) in values) {
      // Header values are always arrays, even when there is exactly one.
      val array = Arguments.createArray()
      list.forEach(array::pushString)
      headers.putArray(names.getValue(key), array)
    }

    // `setCookie` is sourced from the cookie jar's accumulated state, not from
    // per-hop `Set-Cookie` header text, matching iOS (which drains its
    // ephemeral `HTTPCookieStorage` the same way). `InstructionCookieJar.store`
    // already overwrites by (name, domain, path) identity as the redirect chain
    // is followed, so if a bank re-sets the same cookie on a later hop — e.g.
    // rotating a session id mid-chain — only the final value is emitted here.
    // A header-sourced list would emit both the stale and the current value as
    // separate entries, which is exactly the bug this fixes.
    val cookies = Arguments.createArray()
    jar.accumulatedCookies().forEach { cookies.pushString(it.toString()) }

    return Arguments.createMap().apply {
      putInt("status", response.code)
      putMap("headers", headers)
      putString("body", response.body?.string() ?: "")
      // The request of the final response, i.e. the last hop's target.
      putString("finalUrl", response.request.url.toString())
      putArray("setCookie", cookies)
    }
  }

  /**
   * `null` for methods that cannot carry one, an empty body for methods that
   * require one, and otherwise the body Blocks supplied.
   *
   * The content type is deliberately left `null` so OkHttp's BridgeInterceptor
   * does not overwrite the `Content-Type` header Blocks set explicitly.
   */
  private fun requestBody(method: String, body: String?): RequestBody? = when {
    method == "GET" || method == "HEAD" -> null
    !body.isNullOrEmpty() -> body.toRequestBody(null)
    method in METHODS_REQUIRING_BODY -> ByteArray(0).toRequestBody(null)
    else -> null
  }

  /**
   * Cookies Blocks handed us for this request. A cookie that OkHttp rejects
   * (an unusable domain or path, whitespace in the name) is skipped rather than
   * failing the whole request — the iOS side behaves the same way, because
   * `+[NSHTTPCookie cookieWithProperties:]` returns nil there.
   */
  private fun seedCookies(request: ReadableMap, url: HttpUrl): List<Cookie> {
    val array = request.getArray("cookies") ?: return emptyList()
    return (0 until array.size()).mapNotNull { index ->
      val entry = array.getMap(index) ?: return@mapNotNull null
      val name = entry.getString("name") ?: return@mapNotNull null
      val value = entry.getString("value") ?: return@mapNotNull null
      val path = entry.getString("path")?.takeIf { it.startsWith("/") } ?: "/"
      val domain = entry.getString("domain")?.takeIf { it.isNotEmpty() } ?: url.host
      runCatching {
        Cookie.Builder()
          .name(name)
          .value(value)
          .path(path)
          // A leading dot is the legacy spelling of "and its subdomains", which
          // is what `domain()` (as opposed to `hostOnlyDomain()`) already means.
          .domain(domain.removePrefix("."))
          .apply {
            if (entry.hasKey("secure") && entry.getBoolean("secure")) secure()
            if (entry.hasKey("httpOnly") && entry.getBoolean("httpOnly")) httpOnly()
          }
          .build()
      }.getOrNull()
    }
  }

  /**
   * A cookie jar with the lifetime of one instruction request.
   *
   * It accumulates: a cookie the bank sets on the first hop of a redirect chain
   * is sent on the second, which is what an ordinary browser (and the iOS side's
   * ephemeral `HTTPCookieStorage`) does. A jar that only ever replayed the
   * seeded cookies would drop the session cookie every bank sets mid-redirect.
   */
  private class InstructionCookieJar(seed: List<Cookie>) : CookieJar {
    private val cookies = ArrayList<Cookie>()

    init {
      seed.forEach(::store)
    }

    // Renamed from the supertype's `cookies` (which this class also has as a
    // field name) so the parameter no longer shadows it — a trap for future
    // edits inside this function body. `@Suppress` silences the resulting
    // "parameter name changed on override" warning: nothing here calls
    // `saveFromResponse` with a named argument, so there is no real hazard.
    @Suppress("PARAMETER_NAME_CHANGED_ON_OVERRIDE")
    @Synchronized
    override fun saveFromResponse(url: HttpUrl, newCookies: List<Cookie>) {
      newCookies.forEach(::store)
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
      val now = System.currentTimeMillis()
      return cookies.filter { it.matches(url) && it.expiresAt > now }
    }

    /**
     * The jar's cookie state at the end of the redirect chain, i.e. exactly
     * what this jar would send on a next request: this is the source of the
     * `setCookie` result, in place of raw per-hop `Set-Cookie` header text.
     * Because `store` already dedups by (name, domain, path) identity, a
     * cookie the bank re-sets on a later hop — rotating a session id
     * mid-chain — appears here once, as its current value, not once per hop.
     * An already-expired entry (a cookie the bank explicitly deleted mid-chain)
     * is excluded, matching `loadForRequest`.
     */
    @Synchronized
    fun accumulatedCookies(): List<Cookie> {
      val now = System.currentTimeMillis()
      return cookies.filter { it.expiresAt > now }
    }

    private fun store(cookie: Cookie) {
      cookies.removeAll {
        it.name == cookie.name && it.domain == cookie.domain && it.path == cookie.path
      }
      cookies.add(cookie)
    }
  }

  companion object {
    const val NAME = NativeInsurelyHttpSpec.NAME

    private const val SET_COOKIE = "Set-Cookie"

    private val METHODS_REQUIRING_BODY =
      setOf("POST", "PUT", "PATCH", "PROPPATCH", "REPORT")

    /**
     * Timeouts match `URLSessionConfiguration`'s default 60s
     * `timeoutIntervalForRequest`, so a slow bank does not fail on Android while
     * succeeding on iOS.
     */
    private val sharedClient = OkHttpClient.Builder()
      .connectTimeout(30, TimeUnit.SECONDS)
      .readTimeout(60, TimeUnit.SECONDS)
      .writeTimeout(60, TimeUnit.SECONDS)
      .followRedirects(true)
      .followSslRedirects(true)
      .build()
  }
}
