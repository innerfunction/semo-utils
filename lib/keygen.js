var uuid = require('node-uuid');
var crypto = require('crypto');

// Key counter; used by the TIME based function.
var KeyCounter = 0x10;

// Key gen methods.
var Methods = {
    // UUID based method.
    UUID: function() {
        return uuid.v4();
    },
    /**
     * Alternative library key generator. Works by -
     * + Converting the current time ms to hex.
     * + Appending a counter value; the counter cycles between 16 (0x10) and 255 (0xFF).
     * + Appending the first 6 digits of a random number in hex (less the preceeding 0.)
     * The key returned by this function is 20 characters long, and is similar to the
     * default CouchDB document ID format.
     */
    TIME: function() {
        if( KeyCounter >= 0xff ) KeyCounter = 0x10;
        return Date.now().toString( 16 ) + (KeyCounter++).toString( 16 ) + Math.random().toString( 16 ).substring( 2, 9 );
    },
    /**
     * Library key generator that returns an MD5 hash calculated from the current time and
     * a random number.
     * The key returned is a 16 byte / 32 character long hex string.
     */
    MD5_TIME: function() {
        var md5 = crypto.createHash('md5');
        md5.update( Date.now().toString() );
        md5.update( Math.random().toString() );
        return md5.digest('hex');
    }
}

exports.init = function( method ) {
    var fn;
    if( method ) {
        fn = Methods[method];
    }
    if( !fn ) {
        fn = Methods.TIME;
    }
    return fn;
}
