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
 * @param components    An object describing components to add to the bus.
 *                      Each property name is the name the component will be
 *                      added under. Each property value should have a
 *                      'component' property mapped to the component instance.
 *                      An optional 'config' property can also be provided,
 *                      which will be passed to the component's init() method.
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
        var item = components[name];
        this.add( name, item.component, item.config );
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
        invoke( component, 'init', [ name, bus.components, config ])
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
        return invoke( component, 'init', [ name, bus.components, config ] );
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
    });
}

/**
 * Get a named component. By default, this function will assert that the component exists
 * before returning it.
 * @param name      The name of the required component.
 * @param noassert  If true then no component assertion is performed.
 */
SemoBus.prototype.get = function( name, noassert ) {
    var component = this.components[name];
    if( !noassert ) {
        mods.assert( !!component, mods.util.format('Component %s not found on bus', name ));
    }
    return component;
}

/**
 * Invoke a callback function once a named component is added.
 */
SemoBus.prototype.onceAdded = function( name, cb ) {
    this.addListener('add', name, cb );
}

/**
 * Invoke a callback function once a named component is started.
 */
SemoBus.prototype.onceStarted = function( name, cb ) {
    this.addListener('start', name, cb );
}
