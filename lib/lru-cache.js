/**
 * An LRU cache implementation. Maintains a cache of items, bounded by some criteria (such as maximum
 * size of all items in cache). Cache items are automatically invalidated in least recently used order
 * to maintain the bound condition.
 * All cache items are organized into groups to facilitate efficient partial cache invalidation.
 */
var seriesStart = -9999999999, seriesEnd = 9999999999;
var testMode = false;

// An object for generating ascending series numbers for cache items.
function NumberSeries() {
    var n = seriesStart;
    this.next = function() {
        if( n == seriesEnd ) {
            throw "SeriesOverflow";
        }
        return n++;
    };
    this.reset = function() {
        n = seriesStart;
    };
}

function createKey() {
    var id, group;
    if( arguments.length == 1 ) {
        group = arguments[0];
    }
    else {
        id = arguments[0];
        group = arguments[1];
    }
    return { id: id, group: group };
}


// Return the index of an item within the cache list, or -1 if the item isn't found.
// Uses a binary search, so relies on the cache list being in descending number series order.
function indexOfItem( cache, item ) {
    if( cache.length < 20 ) {
        // For small cache sizes, use the built in indexOf method as this is likely to be faster.
        // (NOTE: The cut-off length of 20 isn't currently based on any actual performance metrics).
        return cache.indexOf( item );
    }
    var rs = 0, re = cache.length - 1, rm;      // Range start, range end, range mid-point.
    while( re > rs ) {                          // While range end is after range start...
        rm = Math.floor( (rs + re) / 2 );       // Calculate the range mid-point.
        var i = cache[rm];                      // Read the item at the mid-point.
        if( i === item ) {                      // If we've found the item then break, return its index.
            break;
        }
        if( i.sno > item.sno ) {                // Else if this index's series number is greater...
            rs = ++rm;                          // ...then move the range start to just after this point.
        }
        else {
            re = --rm;                          // ...else move the range end to just before this point.
        }
    }
    return cache[rm] === item ? rm : -1;        // Check if we've found the item.
}
// TODO: Knowing that items are numbered consecutively, it might be possible to optimizing this search
// by saying that the search range end index can't be greater than (cache[0].sno - item.sno) - obviously
// more likely to be useful when the target item was accessed only recently before the cache head.


// Return a new cache array with the specified item at its head. If the item is already in the array then it will be
// moved to the first position; otherwise a new array is returned with the item at its head.
function toHead( cache, item, series, move ) {
    // Find the item's index, but only if moving an existing item.
    var i = move ? indexOfItem( cache, item ) : -1;
    // Special case - item is already head of cache.
    if( i == 0 ) {
        return cache;
    }
    // Update the item's series number (don't do before search, otherwise search won't work...)
    try {
        item.sno = series.next();
    }
    catch( e ) {
        // In case of series number overflow, reset the counter and renumber the cache list.
        series.reset();
        for( var j = cache.length - 1; j >= 0; j-- ) {
            cache[j].sno = series.next();
        }
        item.sno = series.next();
        if( testMode ) {
            console.log('Cache item numbering series overflow');
            console.log('Cache items renumbered: %j', cache );
            console.log('series.next() -> %d', item.sno );
        }
    }
    if( i > -1 ) {
        // Item is being moved, so slice the cache list around its previous position.
        return [ item ].concat( cache.slice( 0, i ), cache.slice( i + 1 ) );
    }
    else {
        // Item is being added, so simply append the current cache list to the item.
        return [ item ].concat( cache );
    }
}

// Remove a cache item. This implementation doesn't actually remove the items from the cache list, instead it just
// invalidates the item by dereferencing its data and setting the item size to zero. The item will eventually be
// removed from the tail of the cache list when the list is being pruned after an add operation.
function removeItem( cache, item ) {
    delete item.data;
    item.size = 0;
    return cache;
}

/**
 * Cache constuctor.
 * @boundCondition  A function used to test whether a tail (LRU) item should be removed from the cache because
 *                  it breaks the bound condition.
 */
function LRUCache( boundCondition ) {
    // The cache item groups.
    var groups = {};
    // A list of cache items, in most recently accessed order.
    var cache = [];
    // The total size of all items in the cache.
    var totalSize = 0;
    // Cache item serial numbers.
    var series = new NumberSeries();
    
    // Test whether the cache contains an item.
    this.has = function( key ) {
        var group = groups[key.group];
        var item = group && group[key.id];
        return !!(item && item.data);
    };
    // Attempt to read data from the cache.
    // @key:    The key the data is stored under. Must have 'group' and 'id' properties.
    this.get = function( key ) {
        // TODO: Consider support for getting an entire group (i.e. key argument has only
        // the group ID specified). Note though that this would require multiple toHead
        // requests for each item in the group.
        var item = false;
        var group = groups[key.group];
        if( group ) {
            item = group[key.id];
            if( item ) {
                cache = toHead( cache, item, series, true );
            }
        }
        if( item ) {
            item.time = Date.now();
            return item.data;
        }
        return undefined;
    };
    // Add an item to the cache. Will update an existing item if the key is already in the cache.
    // @data:   The data to add.
    // @key:    The key to store the data under. Must have 'group' and 'id' properties.
    // @size:   The data size.
    // @cb:     An optional callback function to invoke after the cache tail has been pruned.
    this.add = function( data, key, size, cb ) {
        size = size||0;
        var item = false;
        // Find item's group.
        var group = groups[key.group];
        if( group ) {
            // Group exists, try to find item on group.
            item = group[key.id];
        }
        else {
            // Group doesn't exist so create a new one for the item.
            groups[key.group] = group = {};
        }
        // Update or insert the item.
        if( item ) {
            // Updating existing item, so modify the cache size then move item to cache head.
            totalSize += (size - item.size);
            item.size = size;
            item.data = data;
            cache = toHead( cache, item, series, true );
        }
        else {
            // Inserting new item, so modify cache size then add item to head.
            item = { key: key, data: data, size: size };
            group[key.id] = item;
            totalSize += size;
            cache = toHead( cache, item, series, false );
        }
        item.time = Date.now();
        this.prune( cb );
        return item;
    };

    // Remove an item or item group from the cache.
    // @key     The item's cache key. key.id can be null if removing a group.
    // @cb      An optional callback function to invoke after the operation.
    this.remove = function( key, cb ) {
        var group = groups[key.group];
        if( key.id ) {
            if( group ) {
                process.nextTick(function() {
                    var item = group[key.id];
                    if( item ) {
                        totalSize -= item.size;
                        delete group[key.id];
                        cache = removeItem( cache, item );
                        if( Object.keys( group ).length == 0 ) {
                            delete groups[key.group];
                        }
                    }
                    cb && cb();
                });
            }
            else cb && cb();
        }
        else {
            process.nextTick(function() {
                for( var id in group ) {
                    var item = group[id];
                    totalSize -= item.size;
                    cache = removeItem( cache, item );
                }
                delete groups[key.group];
                cb && cb();
            });
        }
    };

    // Prune LRU items from the tail of the cache.
    // This method is invoked automatically by add() so it shouldn't normally be necessary to call this
    // method directly, but for an age bounded cache it may sometimes be useful.
    // @cb  An optional callback function to invoke after the operation.
    this.prune = function( cb ) {
        var self = this;
        process.nextTick(function() {
            // Check that the cache is within its size limits. Working from the cache tail, remove
            // items until cache is below max size.
            var i = cache.length - 1, prunedGroups = {};
            for( var tailItem = cache[i]; i >= 0 && boundCondition( tailItem, totalSize, self ); tailItem = cache[--i] ) {
                totalSize -= tailItem.size;         // Reduce total size.
                key = tailItem.key;                 // Read item key.
                group = groups[key.group];          // Read item group.
                delete group[key.id];               // Remove item from group.
                prunedGroups[key.group] = group;    // Record group pruning.
            }
            // Trim the cache list to remove the pruned items.
            if( i < cache.length - 1 ) {
                cache = cache.slice( 0, i + 1 );
            }
            // Remove any groups left empty after the pruning.
            for( var id in prunedGroups ) {
                group = prunedGroups[id];
                if( Object.keys( group ).length == 0 ) {
                    delete groups[id];
                }
            }
            cb && cb();
        });
    };
    // Inspect the cache contents.
    this.inspect = function() {
        return {
            totalSize: totalSize,
            groups: Object.keys( groups ),
            items: cache
        };
    };
    // Return the items stored under a specified group. Returns undefined if the group doesn't exist.
    // Isn't counted as a cache hit, so doesn't change the LRU order of the group's items.
    this.group = function( id ) {
        return groups[id];
    };

    this.key = createKey;

    // Enable test mode.
    // This is provided specifically for testing the numbering series overflow/renumber functionality.
    this.testMode = function( range ) {
        testMode = true;
        seriesStart = 0
        seriesEnd = range||20;
        series = new NumberSeries();
    };
}

/**
 * Create a new cache of the specified maximum size.
 */
exports.createWithMaxSize = function( maxSize ) {
    return new LRUCache(function( tailItem, totalSize ) {
        return totalSize > maxSize;
    });
};

/**
 * Create a new cache with a specified maximum age for cache items.
 * @maxAge  A ms duration value.
 */
exports.createWithMaxAge = function( maxAge ) {
    return new LRUCache(function( tailItem, totalSize ) {
        return (Date.now() - tailItem.time) > maxAge;
    });
};

/**
 * Create a new cache with the specified bound condition.
 * @fn  A function taking the following arguments and returning 'true' if the last cache item should be
 *      removed from the cache because it is outside of the cache bound condition.
 *      @tailItem   The LRU item in the cache.
 *      @totalSize  The sum of a the sizes of all items in the cache.
 */
exports.createWithBoundCondition = function( fn ) {
    return new LRUCache( fn );
};

// Create a cache key.
exports.key = createKey;

