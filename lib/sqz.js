var Q = require('q');

// A transaction wrapper function which takes a Q promise returning function,
// and invokes that function within a DB transaction. If the function resolves
// correctly then the transaction is committed; else the transaction is
// rolled-back. This function returns a deferred promise resolving to the
// result of the wrapped function.
function transaction( db, fn ) {
    var dp = Q.defer();
    db.transaction()
    .then(function transact( t ) {
        try {
            // Call the wrapped function, passing an object suitable to use an an options
            // object on standard Sequelize method calls. (This object has a transaction:
            // property; code wanting to include additional options should create a new
            // object, and copy the transaction property to the new object).
            // NOTE: This assumes that fn() returns a *Sequelize* promise, not a Q promise.
            return fn({ transaction: t })
            .then(function commit( result ) {
                t.commit()
                .then(function resolve() {
                    dp.resolve( result );
                });
            })
            .catch(function error( err ) {
                t.rollback()
                .then(function reject() {
                    dp.reject( err );
                });
            });
        }
        catch( e ) {
            return t.rollback()
            .then(function reject() {
                dp.reject( e );
            });
        }
    });
    return dp.promise;
}

// Utility method for resolving a list of Sequelize promises.
// This is different from Sequelize's Promise.all function in that the list of promises
// to resolve is specified as the arguments array.
function resolveAll( Sqz ) {
    var promises = [];
    for( var i = 0; i < arguments.length; i++ ) promises.push( arguments[i] );
    return Sqz.Promise.all( promises );
}

// Utility method for wrapping a value in a Sequelize/Bluebird promise.
function asPromise( Sqz, value ) {
    return new Sqz.Promise(function( resolve ) {
        resolve( value );
    });
}

exports.model = function( Sqz, db ) {
    return {
        Sqz: Sqz,
        db:  db,
        transaction: function( fn ) {
            return transaction( db, fn );
        },
        resolveAll: function() {
            return resolveAll( Sqz );
        },
        asPromise: function( value ) {
            return asPromise( Sqz, value );
        },
        sync: function( force ) {
            return db.sync({ force: force });
        }
    }
}

/**
 * Make a function for filtering values related to a model resource (i.e. table record).
 * @param model     The application model.
 * @param resource  A resource name.
 * @return A function suitable for use as an filterValue class method on resource model.
 */
exports.filterValues = function( model, resource ) {
    /**
     * A method function for filtering a set of name/value pairs to those named properties
     * supported by the associated DAO.
     * @param values    The set of values to filter.
     * @param excludes  An optional list of additional property names to exclude.
     *                  Can also be specified as a set of excluded property names
     *                  mapped to true.
     */
    return function filterValues( values, excludes ) {
        var result = {};
        // Normalize excludes to a map of excluded names.
        if( Array.isArray( excludes ) ) {
            excludes = excludes.reduce(function( result, name ) {
                result[name] = true;
                return result;
            }, {});
        }
        // Read set of defined attributes on the resource model.
        var attrs = model[resource].attributes;
        // Copy values to this, provided the value is a named attribute, and the
        // name isn't excluded.
        for( var name in values ) {
            if( attrs.hasOwnProperty( name ) && !excludes[name] ) {
                result[name] = values[name];
            }
        }
        return result;
    }
}

/**
 * Make a function for applying values to a model resource (i.e. table record).
 * Any field definitions on the model marked with semo$restricted will be excluded from the
 * set of values applied to the resource.
 * @param model     The application model.
 * @param resource  A resource name.
 * @return A function suitable for use as an applyValues method.
 */
exports.applyValues = function( model, resource, excludes ) {
    // Uninitialized set of excluded (i.e. semo$restricted) property names.
    // We can't initialize it at this point because typically the model hasn't yet been
    // initialized when this function is called.
    var excludes = false;
    return function applyValues( values ) {
        var resourceModel = model[resource];
        // Initialize excludes it not already.
        if( !excludes ) {
            excludes = {};
            for( var name in resourceModel.attributes ) {
                var attr = resourceModel.attributes[name];
                if( attr['semo:restricted'] ) {
                    excludes[name] = true;
                }
            }
        }
        // Filter values so that only non-restricted name/values relevant to the resource
        // are included.
        values = resourceModel.filterValues( values, excludes );
        // Update attributes on the resource.
        return this.updateAttributes( values );
    }
}
