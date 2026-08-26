// Copyright © 2026 Insurely AB. All rights reserved.

#import "InsurelyHttp.h"

/// Collects headers from every response in the redirect chain, not only the
/// last one, and exposes the final URL after redirects.
@interface InsurelyHttpRedirectRecorder : NSObject <NSURLSessionTaskDelegate>

@property (nonatomic, readonly) NSMutableArray<NSHTTPURLResponse *> *responses;
@property (nonatomic, strong, nullable) NSURL *finalURL;

@end

@implementation InsurelyHttpRedirectRecorder

- (instancetype)init
{
  if (self = [super init]) {
    _responses = [NSMutableArray array];
  }
  return self;
}

- (void)URLSession:(NSURLSession *)session
                              task:(NSURLSessionTask *)task
        willPerformHTTPRedirection:(NSHTTPURLResponse *)response
                        newRequest:(NSURLRequest *)request
                 completionHandler:(void (^)(NSURLRequest *_Nullable))completionHandler
{
  [self.responses addObject:response];
  // Each hop's target becomes the best known final URL; the last one to be
  // recorded is the URL the chain actually settled on.
  if (request.URL != nil) {
    self.finalURL = request.URL;
  }
  completionHandler(request);
}

/// iOS 16+ only (`API_AVAILABLE(ios(16.0))` in `NSURLSession.h`). On older
/// systems this is simply never called and `finalURL` falls back to the final
/// response's own URL.
- (void)URLSession:(NSURLSession *)session didCreateTask:(NSURLSessionTask *)task
{
  self.finalURL = task.currentRequest.URL;
}

@end

/// Builds an `NSHTTPCookie` from one entry of the instruction request's
/// `cookies` array. Returns nil when a required property is missing.
static NSHTTPCookie *InsurelyHttpMakeCookie(const JS::NativeInsurelyHttp::HttpRequestCookiesElement &properties)
{
  NSString *name = properties.name();
  NSString *value = properties.value();
  NSString *domain = properties.domain();
  NSString *path = properties.path();

  if (name == nil || value == nil || domain == nil || path == nil) {
    return nil;
  }

  // As recommended by Apple Developer Technical Support; there is no
  // NSHTTPCookiePropertyKey constant for HttpOnly.
  NSHTTPCookiePropertyKey const httpOnlyKey = (NSHTTPCookiePropertyKey) @"HttpOnly";

  NSMutableDictionary<NSHTTPCookiePropertyKey, id> *cookieProperties = [NSMutableDictionary dictionaryWithDictionary:@{
    NSHTTPCookieName : name,
    NSHTTPCookieValue : value,
    NSHTTPCookieDomain : domain,
    NSHTTPCookiePath : path,
  }];

  // NSHTTPCookie treats the *presence* of NSHTTPCookieSecure/HttpOnly in the
  // properties dictionary as marking the cookie secure/HttpOnly, regardless
  // of the value assigned to it -- so these keys must only be added when
  // true, never set to @NO.
  if (properties.secure()) {
    cookieProperties[NSHTTPCookieSecure] = @YES;
  }
  if (properties.httpOnly()) {
    cookieProperties[httpOnlyKey] = @YES;
  }

  return [NSHTTPCookie cookieWithProperties:cookieProperties];
}

/// Percent-encodes `value` using the URL-query-allowed character set, exactly
/// as `HTTPCookie+ToSetCookieHeader.swift`'s `encoded(_:)` helper does. Can
/// return nil for a string that cannot be represented this way.
static NSString *_Nullable InsurelyHttpPercentEncode(NSString *value)
{
  return [value stringByAddingPercentEncodingWithAllowedCharacters:[NSCharacterSet URLQueryAllowedCharacterSet]];
}

/// Builds a complete `Set-Cookie` header string for one drained cookie,
/// porting `HTTPCookie+ToSetCookieHeader.swift` (`toSetCookieString`) from
/// the production iOS SDK. Returns nil when the cookie's name or value
/// cannot be percent-encoded, matching the Swift original -- a cookie that
/// cannot be represented is skipped rather than emitted half-formed.
static NSString *_Nullable InsurelyHttpSetCookieHeader(NSHTTPCookie *cookie)
{
  NSString *name = InsurelyHttpPercentEncode(cookie.name);
  NSString *value = InsurelyHttpPercentEncode(cookie.value);
  if (name == nil || value == nil) {
    return nil;
  }

  NSMutableArray<NSString *> *cookieParts =
      [NSMutableArray arrayWithObject:[NSString stringWithFormat:@"%@=%@", name, value]];

  if (cookie.expiresDate != nil) {
    NSDateFormatter *dateFormatter = [NSDateFormatter new];
    // The Swift original does not fix the locale, so the formatted month/day
    // names would otherwise follow the device's locale and the header would
    // become unparseable by servers expecting RFC-1123-style English text.
    // Pinning to en_US_POSIX is a deliberate improvement over the original.
    dateFormatter.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
    dateFormatter.timeZone = [NSTimeZone timeZoneWithAbbreviation:@"GMT"];
    dateFormatter.dateFormat = @"EEE, dd-MMM-yyyy HH:mm:ss zzz";
    [cookieParts addObject:[NSString stringWithFormat:@"Expires=%@",
                                                        [dateFormatter stringFromDate:cookie.expiresDate]]];
  }

  NSString *domain = InsurelyHttpPercentEncode(cookie.domain);
  if (domain != nil) {
    [cookieParts addObject:[NSString stringWithFormat:@"Domain=%@", domain]];
  }

  NSString *path = InsurelyHttpPercentEncode(cookie.path);
  if (path != nil) {
    [cookieParts addObject:[NSString stringWithFormat:@"Path=%@", path]];
  }

  if (cookie.secure) {
    [cookieParts addObject:@"Secure"];
  }

  if (cookie.HTTPOnly) {
    [cookieParts addObject:@"HttpOnly"];
  }

  NSHTTPCookieStringPolicy sameSite = cookie.sameSitePolicy;
  if ([sameSite isEqualToString:NSHTTPCookieSameSiteStrict]) {
    [cookieParts addObject:@"SameSite=Strict"];
  } else if ([sameSite isEqualToString:NSHTTPCookieSameSiteLax]) {
    [cookieParts addObject:@"SameSite=Lax"];
  }

  return [cookieParts componentsJoinedByString:@"; "];
}

/// Decodes a response body to text.
///
/// UTF-8 alone is not enough: `-initWithData:encoding:NSUTF8StringEncoding`
/// returns nil for *any* byte sequence that is not valid UTF-8, and the previous
/// `?: @""` fallback turned that into an empty body -- a silent, iOS-only
/// collection failure for a bank serving, say, ISO-8859-1 HTML containing the
/// byte 0xE5 (a Swedish a-ring). Android goes through OkHttp's `body.string()`,
/// which honours the Content-Type charset and never returns an empty string
/// for a non-empty body.
///
/// Order, matching that behaviour:
///   1. the charset the response itself declared, when Foundation recognises it;
///   2. UTF-8, the correct guess for an undeclared modern body;
///   3. ISO-8859-1, which maps every one of the 256 byte values to a code point
///      and therefore always succeeds. Lossy in meaning, never in content --
///      strictly better than discarding the body.
static NSString *InsurelyHttpDecodeBody(NSData *_Nullable data, NSHTTPURLResponse *response)
{
  if (data.length == 0) {
    return @"";
  }

  NSString *declaredEncodingName = response.textEncodingName;
  if (declaredEncodingName != nil) {
    CFStringEncoding cfEncoding =
        CFStringConvertIANACharSetNameToEncoding((__bridge CFStringRef)declaredEncodingName);
    if (cfEncoding != kCFStringEncodingInvalidId) {
      NSStringEncoding declaredEncoding = CFStringConvertEncodingToNSStringEncoding(cfEncoding);
      NSString *declaredText = [[NSString alloc] initWithData:data encoding:declaredEncoding];
      if (declaredText != nil) {
        return declaredText;
      }
    }
  }

  NSString *utf8Text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  if (utf8Text != nil) {
    return utf8Text;
  }

  return [[NSString alloc] initWithData:data encoding:NSISOLatin1StringEncoding] ?: @"";
}

@implementation InsurelyHttp

- (void)execute:(JS::NativeInsurelyHttp::HttpRequest &)request
        resolve:(RCTPromiseResolveBlock)resolve
         reject:(RCTPromiseRejectBlock)reject
{
  // `request` is backed by an RCTManagedPointer that only lives for the
  // duration of this call, so every field is read out before going async.
  NSString *urlString = request.url();
  NSURL *url = urlString != nil ? [NSURL URLWithString:urlString] : nil;
  if (url == nil) {
    reject(@"invalid_url", @"Instruction request has an invalid URL", nil);
    return;
  }

  NSMutableURLRequest *urlRequest = [NSMutableURLRequest requestWithURL:url];
  NSString *method = request.method();
  urlRequest.HTTPMethod = method.length > 0 ? method : @"GET";
  urlRequest.HTTPShouldHandleCookies = YES;

  NSString *body = request.body();
  if (body.length > 0 && ![urlRequest.HTTPMethod.uppercaseString isEqualToString:@"GET"]) {
    urlRequest.HTTPBody = [body dataUsingEncoding:NSUTF8StringEncoding];
  }

  id headers = request.headers();
  if ([headers isKindOfClass:[NSDictionary class]]) {
    for (id name in (NSDictionary *)headers) {
      id value = ((NSDictionary *)headers)[name];
      if ([name isKindOfClass:[NSString class]] && [value isKindOfClass:[NSString class]]) {
        [urlRequest setValue:(NSString *)value forHTTPHeaderField:(NSString *)name];
      }
    }
  }

  // An ephemeral session gives this request its own cookie jar, so instruction
  // cookies never leak into or out of the app's shared storage.
  NSURLSessionConfiguration *configuration = [NSURLSessionConfiguration ephemeralSessionConfiguration];
  std::optional<facebook::react::LazyVector<JS::NativeInsurelyHttp::HttpRequestCookiesElement>> cookies =
      request.cookies();
  if (cookies.has_value()) {
    for (auto const cookieProperties : cookies.value()) {
      NSHTTPCookie *httpCookie = InsurelyHttpMakeCookie(cookieProperties);
      if (httpCookie == nil) {
        continue;
      }
      [configuration.HTTPCookieStorage setCookie:httpCookie];
    }
  }

  InsurelyHttpRedirectRecorder *recorder = [InsurelyHttpRedirectRecorder new];
  NSURLSession *session = [NSURLSession sessionWithConfiguration:configuration
                                                        delegate:recorder
                                                   delegateQueue:nil];

  NSURLSessionDataTask *task = [session
      dataTaskWithRequest:urlRequest
        completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
          // The task has already finished by the time this runs, so tearing the
          // session down first both releases its strong reference to the
          // recorder and covers every early return below.
          [session finishTasksAndInvalidate];

          if (error != nil) {
            reject(@"request_failed", error.localizedDescription, error);
            return;
          }
          if (![response isKindOfClass:[NSHTTPURLResponse class]]) {
            reject(@"invalid_response", @"Response was not an HTTP response", nil);
            return;
          }
          NSHTTPURLResponse *httpResponse = (NSHTTPURLResponse *)response;

          [recorder.responses addObject:httpResponse];

          NSMutableDictionary<NSString *, NSMutableArray<NSString *> *> *collectedHeaders =
              [NSMutableDictionary dictionary];
          NSMutableArray<NSString *> *setCookie = [NSMutableArray array];

          for (NSHTTPURLResponse *candidate in recorder.responses) {
            for (id key in candidate.allHeaderFields) {
              id value = candidate.allHeaderFields[key];
              if (![key isKindOfClass:[NSString class]] || ![value isKindOfClass:[NSString class]]) {
                continue;
              }
              NSString *name = (NSString *)key;
              NSString *text = (NSString *)value;
              // Set-Cookie is stripped out of `headers` entirely -- it is
              // populated below, only from the cookie jar, so it is never
              // duplicated and never loses attributes to the collapsed
              // `allHeaderFields` text.
              if ([name.lowercaseString isEqualToString:@"set-cookie"]) {
                continue;
              }
              NSMutableArray<NSString *> *values = collectedHeaders[name];
              if (values == nil) {
                values = [NSMutableArray array];
                collectedHeaders[name] = values;
              }
              [values addObject:text];
            }
          }

          for (NSHTTPCookie *cookie in configuration.HTTPCookieStorage.cookies ?: @[]) {
            NSString *header = InsurelyHttpSetCookieHeader(cookie);
            if (header != nil) {
              [setCookie addObject:header];
            }
          }

          NSString *finalUrl = recorder.finalURL.absoluteString ?: httpResponse.URL.absoluteString ?: urlString;
          NSString *bodyText = InsurelyHttpDecodeBody(data, httpResponse);

          resolve(@{
            @"status" : @(httpResponse.statusCode),
            @"headers" : collectedHeaders,
            @"body" : bodyText,
            @"finalUrl" : finalUrl,
            @"setCookie" : setCookie,
          });
        }];

  [task resume];
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
    return std::make_shared<facebook::react::NativeInsurelyHttpSpecJSI>(params);
}

+ (NSString *)moduleName
{
  return @"InsurelyHttp";
}

@end
