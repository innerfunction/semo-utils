var Log = require('log4js').getLogger('request-queue');
var Q = require('q');

/**
 * A class for maintaining a queue of deferred request promises.
 */
function RequestQueue() {
    // A map of promise queues, keyed by request content URI.
    this.queues = {};
}
/**
 * Process a request for the specified URI. Creates and returns a deferred
 * promise for the URI content result. Calls the handler function if no
 * other requests for the URI are queued; otherwise adds the deferred
 * promise to the appropriate queue, to be resolved when the handler function
 * completes.
 * @param agent     A system ACL agent.
 * @param uri       The content URI being resolved.
 * @param handler   The request handler function for resolving the URI.
 * @returns A deferred promise resolving to the URI's contents.
 */
RequestQueue.prototype.request = function( agent, uri, handler ) {
    var dp = Q.defer();
    var queue = this.queues[uri];
    if( queue ) {
        queue.push( dp );
    }
    else {
        Log.debug('Creating queue for %s', uri );
        var rq = this;
        this.queues[uri] = queue = [ dp ];
        try {
            handler( agent, uri )
            .then(function( content ) {
                rq.resolve( uri, content );
            })
            .fail(function( err ) {
                rq.reject( uri, err );
            })
            .done();
        }
        catch( err ) {
            dq.reject( uri, err );
        }
    }
    return dp.promise;
}
/**
 * Get the promise queue for a content URI. Deletes the promise queue, if found.
 * @param uri   The content URI being responded to.
 */
RequestQueue.prototype.getQueueForResponse = function( uri ) {
    var queue = this.queues[uri];
    if( queue ) {
        Log.debug('Responding to %d queued promises for %s', queue.length, uri );
        delete this.queues[uri];
        return queue;
    }
    Log.warn('No queue found for %s', uri );
    return [];
}
/**
 * Send a resolution to all queued promises for the specified content URI.
 * @param uri       The content URI being responded to.
 * @param content   The content item result.
 */
RequestQueue.prototype.resolve = function( uri, content ) {
    this.getQueueForResponse( uri, true )
    .forEach(function resolve( dp ) {
        dp.resolve( content );
    });
}
/**
 * Send an error to all queued promises for the specified content URI.
 * @param uri   The content URI being responded to.
 * @param err   The error being sent.
 */
RequestQueue.prototype.reject = function( uri, err ) {
    this.getQueueForResponse( uri, true )
    .forEach(function resolve( dp ) {
        dp.reject( err );
    });
}

module.exports = function() {
    return new RequestQueue();
}
