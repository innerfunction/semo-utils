var Log = require('log4js').getLogger('semo.utils.semaphore');
var Q = require('q');

/**
 * A class for controlling concurrent access to a limited resource.
 * @param limit The maximum number of concurrent calls allowed on the resource
 *              at any one time.
 */
function Semaphore( limit ) {
    this.limit = limit;
    this.calls = 0; // The number of active operation calls.
}
/**
 * Call an operation protected by this semaphore.
 * If the current number of calls on the underlying resource is below the semaphore
 * limit then the op function is called immediately; otherwise the call is queued
 * until other calls complete and the number of calls drops below the limit.
 * @param op    The operation function to be called.
 * @return A deferred promise resolving to the operation result.
 */
Semaphore.prototype.call = function( op ) {
    var dp = Q.defer();
    // If number of active calls is below the semaphore limit...
    if( this.calls < this.limit ) {
        // ...then call the op now.
        this.callOp( op, dp );
    }
    else {
        // ...else queue the call until later.
        this.pending.push([ op, dp ]);
    }
    return dp.promise;
}
/**
 * Call an operation function.
 * @param op    The operation function.
 * @param dp    A deferred promise waiting for the operation result.
 */
Semaphore.prototype.callOp = function( op, dp ) {
    try {
        // Increment the active call count.
        this.calls++;
        op()
        .then(function then( result ) {
            this.resolve( dp, result );
        })
        .fail(function fail( err ) {
            this.reject( dp, err );
        })
        .done();
    }
    catch( err ) {
        this.reject( dp, err );
    }
}
/**
 * Resolve a deferred promise on an operation result.
 * @param dp        A promise.
 * @param result    The operation result.
 */
Semaphore.prototype.resolve = function( dp, result ) {
    try {
        dp.resolve( result );
    }
    finally {
        this.next();
    }
}
/**
 * Reject a deferred promise on an operation result.
 * @param dp        A promise.
 * @param err       The operation error.
 */
Semaphore.prototype.reject = function( dp, err ) {
    try {
        dp.reject( err );
    }
    finally {
        this.next();
    }
}
/**
 * End an operation call and proceed to the next queued call.
 */
Semaphore.prototype.next = function() {
    // Decrement the number of active calls.
    this.calls--;
    // If another operation call is pending...
    if( this.pending.length > 0 ) {
        // ...then call that op.
        var args = this.pending.shift();
        callOp.apply( this, args );
    }
}

module.exports = function( limit ) {
    return new Semaphore( limit );
}
