/**
 * An application bus. Provides an object to which application components can be
 * attached under unique names and then accessed by other components using the
 * same names.
 *
 * Components undergo a two-stage startup process:
 *
 * > init: The first stage is used to configure a component before it starts.
 *   Components can discover other named components via the bus at this stage.
 *
 * > start: The fully configured components are then started.
 *
 * This two-stage process allows components to resolve other component dependencies
 * before they become fully operational.
 * 
 * Components may implement two methods corresponding to each of these stages:
 *
 * init( bus, config, name ): Initialize the component.
 * @param bus       The bus.
 * @param config    Component config (if any specified).
 * @param name      The name under which the component is registered with the bus.
 *
 * start( name ): Start the component.
 * @param name      The name under which the component is registered with the bus.
 *
 * The bus emits a number of different events:
 * - add:           When a component is added to the bus.
 *                  The component name is passed as the event data.
 * - start:         When a component is started.
 *                  The component name is passed as the event data.
 * - start-error:   When a component fails to start due to an error.
 *                  The component name is passed as the event data.
 * - configure:     When a component's configuration is modified.
 *                  The component name is passed as the event data.
 * - started:       When the bus is fully started.
 *                  The bus is passed as the event data.
 */
var mods = {
    assert: require('assert'),
    events: require('events'),
    util:   require('util')
}
var Q = require('q');

/**
 * Invoke a method on a component object.
 * Checks that the named method exists on the object, handles any errors
 * thrown by the method. The method can be synchronous or return a deferred
 * promise.
 * @param component A component object.
 * @param name      The name of the method to invoke.
 * @param args      An optional array of method arguments.
 * @return A deferred promise resolving to the method result.
 */
function invoke( component, name, args ) {
    var dp = Q.defer();
    // Resolve the method property.
    var method = component[name];
    // Check that the method is a function.
    if( typeof method == 'function' ) {
        try {
            // Call the method function.
            dp.resolve( method.apply( component, args ) );
        }
        catch( err ) {
            dp.reject( err );
        }
    }
    else {
        dp.resolve();
    }
    return dp.promise;
}

/**
 * Make an event listener for the named bus event.
 * Routes general bus events to specific component listeners.
 * @param bus       A bus instance.
 * @param event     The event name, e.g. 'add' or 'start'.
 */
function makeEventListener( bus, event ) {
    /**
     * A bus event listener.
     * @param name A component name.
     */
    return function listener( name ) {
        // Look for listeners for the specific event name.
        var eventListeners = bus.listeners[event];
        if( eventListeners ) {
            // Look for a list of callback functions for the specified
            // component name.
            var callbacks = eventListeners[name];
            if( callbacks ) {
                // Invoke each callback function on the list.
                callbacks.forEach(function callback( cb ) {
                    // Each callback is passed the name of the component
                    // and the bus event name.
                    cb( name, event );
                });
            }
            // Callbacks are called once only; so delete all callbacks for
            // this component.
            delete eventListeners[name];
        }
    }
}

/**
 * Merge one object's properties over anothers, and return the result.
 * @param obj0  The object to merge properties into. Can be undefined.
 * @param obj1  The object whose properties are copied onto obj0.
 * @return obj0 (or a new object if undefined) with obj1's properties copied over.
 */
function merge( obj0, obj1 ) {
    var result = obj0||{};
    for( var id in obj1 ) {
        result[id] = obj1[id];
    }
    return result;
}

/**
 * Register an event callback function for a specific named component.
 * @param bus       A bus instance.
 * @param event     A bus event name.
 * @param name      A component name.
 * @param callback  A callback function, called when the named event is
 *                  emited for the named component.
 */
function registerEventCallback( bus, event, name, callback ) {
    // Register the listener function.
    var eventListeners = bus.listeners[event];
    var callbacks = eventListeners[name];
    if( callbacks ) {
        callbacks.push( callback );
    }
    else {
        eventListeners[name] = callbacks = [ callback ];
    }
}

mods.util.inherits( SemoBus, mods.events.EventEmitter );

/**
 * Create a new bus.
 * @param components    A map of component names onto component definitions.
 *                      Each component definition may have the following properties:
 *                      @property instance      A pre-instantiated component instance.
 *                      @property constructor   A component constructor.
 *                      @property factory       A factory function for building an instance.
 *                      @property config        Component configuration. Passed to the
 *                                              component's init() function at startup.
 *                      If a definition doesn't have an instance, constructor or factory
 *                      property then the definition itself is used as the instance, and
 *                      the config property is ignored.
 */
function SemoBus( components ) {
    // A map of named components.
    this.components = {};
    // A map of component configs, keyed by component name.
    this.configs = {};
    // A map of bus event listeners.
    this.listeners = {
        add: {},
        start: {}
    };
    // Flag indicating whether the bus has started.
    this.started = false;
    // Add the components.
    for( var name in components ) {
        var component = components[name];
        var instance = component.instance;
        var config;
        if( !instance && component.constructor ) {
            instance = new component.constructor();
        }
        if( !instance && component.factory ) {
            instance = component.factory();
        }
        if( !instance ) {
            instance = component;
        }
        else {
            config = component.config;
        }
        this.add( name, instance, config );
    }
    // Add bus event listeners (see whenAdded and whenStarted).
    this.addListener('add', makeEventListener( this, 'add'));
    this.addListener('start', makeEventListener( this, 'start'));
}

/**
 * Add a component to the bus. If the bus is already running then the
 * component will be started immediately. The bus will emit a start-error
 * event if an error happens when starting any component.
 * @param name      The name the component should be added under.
 * @param component The component to add.
 * @param config    Optional component config. Passed to the component's
 *                  init() method when the bus is started.
 */
SemoBus.prototype.add = function( name, component, config ) {
    this.components[name] = component;
    this.configs[name] = config;
    this.emit('add', name );
    if( this.started ) {
        // Bus is running, so init and start the component.
        var bus = this;
        invoke( component, 'init', [ bus, config, name ])
        .then(function start() {
            return invoke( component, 'start', [ name ]);
        })
        .then(function started() {
            bus.emit('start', name );
        })
        .fail(function fail( err ) {
            bus.emit('start-error', err, name );
        });
    }
}

/**
 * Add component configuration. The new configuration is merged over any existing
 * configuration. Emits a 'configure' event for each configured component.
 * @param arg0  If only one argument provided then a map of component names onto
 *              component configurations.
 *              If two arguments provided, then the name of the component being
 *              configured.
 * @param arg1  A component configuration.
 */
SemoBus.prototype.configure = function( arg0, arg1 ) {
    switch( arguments.length ) {
    case 0:
        break;
    case 1:
        for( var name in arg0 ) {
            this.components[name] = merge( this.components[name], arg0[name] );
            this.emit('configure', name );
        }
        break;
    default:
        this.components[arg0] = merge( this.components[arg0], arg1 );
        this.emit('configure', arg0 );
        break;
    }
}
        
/**
 * Start the bus. Initializes and starts any components already added to the bus.
 * @return  A deferred promise that is resolved once all components have started. If
 *          any registered component fails to initialize or start then the promise
 *          is rejected.
 */
SemoBus.prototype.start = function() {
    var bus = this;
    var names = Object.keys( components );
    // Initialize all registered components. The initialization phase allows components
    // to resolve references to other components they may require, before they are started.
    var inits = names.map(function init( name ) {
        var component = bus.components[name];
        var config = bus.configs[name];
        return invoke( component, 'init', [ bus, config, name ] );
    });
    return Q.all( inits )
    .then(function starts() {
        // Start all components.
        var starts = names.map(function start( name ) {
            var component = bus.components[name];
            return invoke( component, 'start', [ name ] );
        });
        return Q.all( starts );
    })
    .then(function started() {
        // All components initialied and started without any errors.
        bus.started = true;
        // Emit a 'start' event for each component.
        names.forEach(function emit( name ) {
            bus.emit('start', name );
        });
        bus.emit('started', bus );
    });
}

/**
 * Get a named component. By default, this function will assert that the component exists
 * before returning it.
 * The component reference may be a dotted property path (e.g. name1.name2.name3). This
 * allows resolution of components on child buses attached to this bus as components.
 * @param ref       A string or array reference to the required component.
 * @param noassert  If true then no component assertion is performed.
 * @param bref      When resolving references on child buses, the portion of ref that
 *                  has been resolved and refers to the current bus.
 * @return The component with the specified name, or null if the component can't be
 *         resolved and noassert is true.
 */
SemoBus.prototype.get = function( ref, noassert, bref ) {
    // Convert a dotted property reference to an array of property names.
    if( typeof ref == 'string' ) {
        ref = ref.split('.');
    }
    // Assert that the reference is now an array.
    mods.assert( Array.isArray( ref ), 'Component ref must be a string or array');
    // Shift the first property name from the reference.
    var name = ref.shift();
    // Calculate base ref for the component.
    bref = bref ? bref.concat( name ) : [ name ];
    // See if we have a component matching the name.
    var component = this.components[name];
    if( !noassert ) {
        mods.assert( !!component, mods.util.format('Component %s not found on bus', bref.join('.') ));
    }
    // If there are names on the reference still to be resolved...
    if( ref.length > 0 ) {
        // ...and the current component is a bus...
        if( component instanceof SemoBus ) {
            // ...then get the bus to resolve the rest of the reference.
            component = component.get( ref, noassert, bref );
        }
        else if( noassert ) {
            // ...otherwise the reference can't be resolved, but don't assert this so return null.
            component = null;
        }
        else {
            // ...otherwise reference can't be resolved so throw an error.
            if( component == null ) {
                // Component not found.
                bref.push( ref[0] );
                throw new Error( mods.util.format('Component %s not found on bus', bref.join('.') ) );
            }
            // Component found but isn't a bus.
            throw new Error( mods.util.format("Component %s can't be used to resolve name %s",
                                bref.join('.'), ref[0] ) );
        }
    }
    // Return the resolved component.
    return component;
}

/**
 * Invoke a callback function once a named component is added.
 * Note: Doesn't support references to components on child buses.
 */
SemoBus.prototype.onceAdded = function( name, cb ) {
    // If component already added then invoke the callback immediately;
    if( this.components[name] ) {
        process.nextTick(function added() {
            cb( name, 'add');
        });
    }
    // Otherwise listen for an 'add' event for the named component.
    else this.addListener('add', name, cb );
}

/**
 * Invoke a callback function once a named component is started.
 * Note: Doesn't support references to components on child buses.
 */
SemoBus.prototype.onceStarted = function( name, cb ) {
    // If started and component already added then invoke the callback now;
    if( this.started && this.components[name] ) {
        process.nextTick(function started() {
            cb( name, 'start');
        });
    }
    // Else listen for a 'start' event for the named component.
    else this.addListener('start', name, cb );
}
