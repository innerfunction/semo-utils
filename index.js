var mods = {
    crypto: require('crypto'),
    fs:     require('./lib/fs'),
    http:   require('./lib/http'),
    keygen: require('./lib/keygen'),
    rqueue: require('./lib/request-queue')
}

/** File system commands. */
// RENAMED commands -> fs
exports.fs = mods.fs;

/** Crypto related functions. */
var crypto = {
    /**
     * Calculate and return a random string suitable for use as a message digest salt.
     * @param enc The encoding of the result; 'binary', 'hex' or 'base64'. Defaults to 'hex'.
     */
    salt: function( enc ) {
        return crypto.digest( Math.random()+date.nowISO(), Math.random(), enc );
    },
    /**
     * Calculate a message digest.
     * @param message The message.
     * @param salt    The digest salt value.
     * @param enc     The encoding of the result; 'binary', 'hex' or 'base64'. Defaults to 'hex'.
     */
    digest: function( message, salt, enc ) {
        if( typeof message == 'string' ) {
            message = new Buffer( message );
        }
        var hmac = mods.crypto.createHmac('sha512', ''+salt );
        hmac.update( message );
        return hmac.digest( enc||'hex');
    }
}
exports.crypto = crypto;

/** Semo HTTP client. */
exports.http = mods.http;

/** Date related utility functions. */
var date = {
    /**
     * Return the current time as an ISO-8601 formatted string.
     */
    nowISO: function() {
        return new Date().toISOString();
    }
}
exports.date = date;

/**
 * Return a new request queue instance.
 */
exports.requestQueue = function() {
    return mods.rqueue();
}

/**
 * Return a new key generator function using the specified method.
 */
exports.keyGen = function( method ) {
    return mods.keygen.init( method );
}
