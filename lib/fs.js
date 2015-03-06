var mods = {
    fs:     require('fs'),
    path:   require('path'),
    spawn:  require('child_process').spawn,
    temp:   require('temp').track()
};
var format = require('util').format;
var platform = require('os').platform();
var Q = require('q');

/**
 * Return a deferred promise to spawn a command with the specified arguments.
 */
function spawn( cmd, args ) {
    var dp = Q.defer();
    var cmd = mods.spawn( cmd, args );
    cmd.on('exit', function exit( err ) {
        if( err != 0 ) {
            dp.reject( new Error( format('Command <%s %s> error code: %s', cmd, args.join(' '), err ) ) );
        }
        else {
            dp.resolve();
        }
    });
    return dp.promise;
}

/**
 * Check that a path argument is valid. (Path can't be /).
 */
function chkpath( path ) {
    if( path == '/' ) {
        throw new Error('path cannot be /');
    }
    return true;
}

var cmds = {};

/**
 * Create a tgz file. Tars the files under the specified path and returns a buffer containing
 * the gzip encoded contents of the tar file.
 */
cmds.tgz = function( path, rmPath ) {
    chkpath( path );
    var tgzPath = mods.temp.path({ prefix: 'semo-build-', suffix: '.tgz' });
    // Create the tar file.
    var cargs = ['zcf', tgzPath, '-C', path, '.'];
    return spawn('tar', cargs )
    .then(function tar() {
        // Read the tar file into a buffer.
        return Q.nfcall( mods.fs.readFile, tgzPath )
        .then(function then( data ) {
            // Delete the tar file.
            mods.fs.unlink( tgzPath );
            // Delete the source directory (if requested).
            if( rmPath ) {
                cmds.rmdir( path );
            }
            return data;
        });
    });
}

/**
 * Unpack a buffer containing tgz data to a location on the file system.
 */
cmds.untgz = function( tgz, path ) {
    chkpath( path );
    var tgzPath = mods.temp.path({ prefix: 'semo-build-', suffix: '.tgz' });
    // Write the tgz argument to file.
    return Q.nfcall( mods.fs.writeFile, tgzPath, tgz )
    .then(function nfcall() {
        return Q.nfcall( mods.fs.mkdir, path );
    })
    .then(function spawn() {
        // Unpack the tgz file.
        var cargs = ['zxf', tgzPath, '-C', path ];
        return spawn('tar', cargs );
    })
    .then(function unlink() {
        // Delete the tgz file.
        mods.fs.unlink( tgzPath );
    });
}

/**
 * Unzip a buffer containing zip data to a location on the file system.
 */
cmds.unzip = function( zip, path ) {
    chkpath( path );
    var zipPath = mods.temp.path({ prefix: 'semo-build-', suffix: '.zip' });
    // Write the zip argument to file.
    return Q.nfcall( mods.fs.writeFile, zipPath, zip )
    .then(function nfcall() {
        // Create the output dir.
        return Q.nfcall( mods.fs.mkdir, path );
    })
    .then(function spawn() {
        // Unpack the tgz file.
        var cargs = [ zipPath ];
        return spawn('unzip', cargs );
    })
    .then(function unlink() {
        // Delete the tgz file.
        mods.fs.unlink( zipPath );
    });
}

/**
 * Remove a directory. Performs an 'rm -Rf' on the specified path.
 */
cmds.rmdir = function( path ) {
    chkpath( path );
    var cargs = ['-Rf', path ];
    return spawn('rm', cargs );
}

/**
 * Make a directory. Performs an 'mkdir -p' on the specified path.
 */
cmds.mkdir = function( path ) {
    chkpath( args );
    var cargs = ['-p', args.path ];
    return spawn('mkdir', cargs );
}

/**
 * Create a symbolic link.
 */
cmds.ln = function( from, to ) {
    var flags;
    switch( platform ) {
    case 'linux':
        // -n: Don't dereference link (Linux).
        flags = '-fns';
        break;
    case 'darwin':
    default:
        // -h: Don't dereference link (BSD/Darwin).
        flags = '-fhs';
    }
    var cargs = [ flags, args.from, args.to ];
    return spawn('ln', cargs );
}

/**
 * Change a file's permissions, group and owner.
 */
cmds.chperms = function( path, perms, cb ) {
    // Implementation note: The system's chmod and chown commands are spawned here, instead of using node's
    // builtin fs.fchown and fs.fchmod functions. This is to allow symbolic arguments - e.g. u+x or apache
    // to be used instead of numeric permission sets or user or group IDs.
    return Q.fcall(function fcall() {
        // Change file mode.
        if( perms.mode ) {
            var cargs = [ perms.mode, path ];
            return spawn('chmod', cargs );
        }
        return Q( true );
    })
    .then(function chown() {
        // Change file owner.
        if( perms.owner || perms.group ) {
            var cargs = [ (perms.owner||'')+(perms.group&&(':'+perms.group)), path ];
            return spawn('chown', cargs );
        }
        return Q( true );
    });
}

/**
 * Find files matching the specified patterns.
 * Returns an array of array paths. All paths are prefixed with @path.
 * @param path  The path to search under.
 * @param opts  Search options. Takes the following properties:
 *              + patterns:     File patterns to search for.
 *              + abs:          If true, then return absolute paths for found files.
 &              + filesonly:    Only search for files (e.g. don't include dirs in results).
 */
cmds.find = function( path, opts ) {
    var dp = Q.defer();
    var fargs = [ path ];
    var patterns = Array.isArray( opts.patterns ) ? opts.patterns : [ opts.patterns ];
    for( var i = 0; i < patterns.length; i++ ) {
        if( fargs.length > 1 ) {
            fargs.push('-or');
        }
        fargs.push('-name');
        fargs.push( patterns[i] );
    }
    if( opts.filesonly ) {
        // Only find standard files.
        fargs.push('-type');
        fargs.push('f');
    }
    var files = [];
    var find = mods.spawn('find', fargs );
    find.stdout.on('data', function data( data ) {
        files = files.concat( data.toString().split(/[\r\n]+/m) );
    });
    // NOTE: Important that this is on the 'close' event and not on 'exit'. The 'close' event is
    // emitted only after all data has been written to stdout/stderr - which may be after the 'exit'
    // event has been emitted.
    find.on('close', function close() {
        // Filter empty items from the file list and return the result.
        files = files.filter(function filter( val ) {
            return val.trim().length > 0;
        });
        // If abs == false then convert to relative file paths.
        if( !opts.abs ) {
            var n = path.length + 1; // +1 is to catch the leading /
            files = files.map(function map( val ) {
                return val.substring( n );
            });
        }
        dp.resolve( files );
    });
    return dp.promise;
}

cmds.chksum = function( path, cb ) {
    var dp = Q.defer();
    var cksum = mods.spawn('cksum', [ path ]);
    var stdout = [];
    cksum.stdout.on('data', function stdout( data ) {
        stdout.push( data );
    });
    cksum.stderr.on('data', function stderr( data ) {
        console.log( data.toString() );
    });
    cksum.on('close', function close() {
        var output = Buffer.concat( stdout ).toString();
        var r = /^(\d+)\s+(\d+)\s+(.+)/.exec( output );
        dp.resolve({
            sum:    r && r[1],
            size:   r && r[2],
            path:   r && r[3]
        });
    });
    return dp.promise;
}

/**
 * Perform a deep copy.
 * Copies all files and directories from one location to another.
 */
cmds.deepcp = function( from, to, cb ) {
    var cargs = ['-R', from, to ];
    return spawn('cp', cargs );
}

/**
 * Perform a shallow (single file) copy.
 */
cmds.cp = function( from, to, cb ) {
    var cargs = [ from, to ];
    return spawn('cp', cargs );
}

/**
 * Perform a move (rename).
 */
cmds.mv = function( from, to, cb ) {
    var dp = Q.defer();
    mods.fs.exists( from, function exists( exists ) {
        var result;
        if( exists ) {
            var dirname = mods.path.dirname( to );
            result = cmds.mkdir( dirname )
            .then(function then() {
                var cargs = [ from, to ];
                return spawn('mv', cargs );
            });
        }
        dp.resolve( result );
    });
    return dp.promise;
}

// Export all commands.
for( var name in cmds ) exports[name] = cmds[name];
