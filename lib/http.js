var Log = require('log4js').getLogger('semo.utils.http');
var Q = require('q');
var format = require('util').format;
var mods = {
    agent:  require('agentkeepalive'),
    http:   require('http'),
    lru:    require('./lru-cache'),
    url:    require('url')
}

var agent = new mods.agent({
    keepAlive: true,
    keepAliveMsecs: 30000
});

/**
 * Create an HTTP request options object.
 */
function httpOpts( method, url, headers ) {
    var opts = mods.url.parse( url );
    opts.path = opts.pathname+(opts.search||'');
    opts.method = method;
    opts.agent = agent;
    opts.headers = headers||{};
    if( !opts.headers.Accept ) {
        opts.headers.Accept = 'application/json';
    }
    return opts;
}

exports.client = function( opts ) {

    // Default request retry count.
    var RetryCount = opts.retryCount||3;
    // Maximum age of entries in the HEAD request cache.
    var HeadCacheMaxAge = opts.headCacheMaxAge||(1000 * 60 * 60 * 24);

    /**
     * GET an HTTP URL. Defaults to Accept: application/json.
     * @param url       The URL to get.
     * @param headers   Additional request headers to include in the request.
     * @param retry     The number of retries to attempt (optional; defaults to 3).
     * @return A promise resolving to an [ data, mimeType, headers ] array.
     */
    function get( url, headers, retry ) {
        if( retry === undefined ) {
            retry = RetryCount;
        }
        var dp = q.defer();
        Log.debug('GETing %s [%d]...', url, retry + 1 );
        var opts = httpOpts('GET', url, headers );
        var req = mods.http.request( opts, function( res ) {
            // TODO: Better handling of other status codes.
            if( res.statusCode == 200 ) {
                var buffer = [];
                res.on('data', function( chunk ) {
                    buffer.push( chunk );
                });
                res.on('end', function() {
                    try {
                        var data = Buffer.concat( buffer ).toString();
                        // Check for BOM (http://en.wikipedia.org/wiki/Byte_Order_Mark) at start of text 
                        // - the node.js JSON parser will reject it.
                        if( data.charCodeAt( 0 ) == 65279 ) {
                            Log.warn('Removing BOM from %s response...', url );
                            data = data.substring( 1 );
                        }
                        var mimeType = res.headers['content-type'];
                        if( mimeType == 'application/json' ) {
                            data = JSON.parse( data );
                        }
                        dp.resolve([ data, mimeType, res.headers ]);
                    }
                    catch( e ) {
                        dp.reject( e );
                    }
                });
            }
            else {
                dp.reject( new Error( format('%d : %s', res.statusCode, res.status )));
            }
        });
        req.on('error', function( err ) {
            // If an error occurs then check the cause, and attempt a retry for some failure types.
            var failure = false;
            if( err == 'Error: read ECONNRESET' ) {
                failure = 'connection reset';
            }
            else if( err == 'Error: read ETIMEDOUT' ) {
                failure = 'connection timeout';
            }
            else if( err == 'Error: socket hang up') {
                failure = 'socket hang up';
            }
            // If failure type identified and retries are left...
            if( failure && retry > 0 ) {
                // ...then try again (with one less retry).
                Log.warn('GET %s %s, attempting retry %d...', url, failure, RetryCount - retry + 1 );
                dp.resolve( get( url, type, retry - 1) );
            }
            else {
                // ...else failure not identified, or no retries left; resolve rather than reject
                // the promise, as this isn't a failure condition.
                // TODO: Make resolve vs. reject behaviour an option?
                Log.error('GET %s %s', url, err );
                dp.resolve();
            }
        });
        req.end();
        return dp.promise;
    }

    // Create an LRU cache for HTTP HEAD requests. Store cache responses for a maximum of 24 hours.
    var CachedHeadResponses = mods.lru.createWithMaxAge( HeadCacheMaxAge );

    // Do a HTTP head request. Cache any previous requests.
    // TODO: Review this, might be better and more reliable to use a proper caching http request object.
    // This implementation relies on an expires header in the response.
    function head( url, headers ) {
        var dp = Q.defer();
        var res = CachedHeadResponses[url];
        if( res && res.expires >= new Date() ) {
            dp.resolve( res );
        }
        else {
            var opts = httpOpts('HEAD', url, headers );
            var req = mods.http.request( opts, function( res ) {
                CachedHeadResponses[url] = {
                    // Use the 'expires' header (if any) to control how long this response is valid for; otherwise
                    // retain the response for 1 min.
                    expires:    res.headers.expires ? new Date( res.headers.expires ) : new Date( Date.now() + 60000 ),
                    statusCode: res.statusCode,
                    headers:    res.headers
                };
                dp.resolve( res );
            });
            req.end();
        }
        return dp.promise;
    }

    return {
        get:    get,
        head:   head
    }
}
