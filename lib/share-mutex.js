var Log = require('log4js').getLogger('semo.utils.share-mutex');
var Q = require('q');

/**
 * A class which applies a mutex lock to operation calls. An operation ID must be
 * supplied with each operation call, to uniquely identify the call. If another call
 * to the same operation is currently in process then the process waits for the
 * operation to complete, and then returns the result of that call.
 * Operation functions sharing the same operation ID are assumed to return the same
 * result.
 * This behaviour has two benefits:
 * - Only one call to each unique operation will take place at any one time.
 * - The result returned by each unique operation will be shared with all processes
 *   waiting for the result.
 */
function ShareMutex() {
    // A map of operation IDs onto arrays of process deferred promises (callbacks).
    // This contains references to processes waiting on the result of any currently
    // running operation.
    this.waits = {};
}
/**
 * Call an operation function. If no call to the same operation (as identified using
 * opID) is currently in place then the function is invoked and its result returned;
 * otherwise the process waits for the in-process operation call to complete before
 * returning its result.
 * The opID is passed as the sole argument when invoking the operation function.
 * @param   opID    A unique ID for the operation function. Operation functions
 *                  sharing the same ID must resolve to the same result.
 * @param   opFn    An operation function. Should return a deferred promise resolving
 *                  to the operation result.
 * @returns A deferred promise resolving to the operation result.
 */
ShareMutex.prototype.call = function( opID, opFn ) {
    var dp = Q.defer();
    var waits = this.waits[opID];
    if( waits ) {
        // This operation has already been called and we are still waiting for a
        // result.
        waits.push( dp );
    }
    else {
        // Nothing currently waiting on the operation, so invoke the op function.
        Log.debug('Creating wait for %s', opID );
        var oq = this;
        this.waits[opID] = waits = [ dp ];
        try {
            opFn( opID )
            .then(function( result ) {
                oq.resolve( opID, result );
            })
            .fail(function( err ) {
                oq.reject( opID, err );
            })
            .done();
        }
        catch( err ) {
            dq.reject( opID, err );
        }
    }
    return dp.promise;
}
/**
 * Get the list of processes waiting for an operation to complete.
 * Deletes the wait queue, if found.
 * @param opID  The ID of the operation being waited for.
 */
ShareMutex.prototype.getOpWaits = function( opID ) {
    var waits = this.waits[opID];
    if( waits ) {
        Log.debug('Responding to %d waiting promises for %s', waits.length, opID );
        delete this.waits[opID];
        return waits;
    }
    Log.warn('No waits found for %s', opID );
    return [];
}
/**
 * Send a resolution to all waiting promises for the specified operation ID.
 * @param opID      The ID of the operation being responded to.
 * @param result    The operation result.
 */
ShareMutex.prototype.resolve = function( opID, result ) {
    this.getOpWaits( opID, true )
    .forEach(function resolve( dp ) {
        dp.resolve( result );
    });
}
/**
 * Send an error to all waiting promises for the specified operation ID.
 * @param opID  The ID of the operation being responded to.
 * @param err   The error being sent.
 */
ShareMutex.prototype.reject = function( opID, err ) {
    this.getOpWaits( opID, true )
    .forEach(function resolve( dp ) {
        dp.reject( err );
    });
}

module.exports = function() {
    return new ShareMutex();
}
