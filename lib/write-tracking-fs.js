/**
 * Created by ThatJoeMoore on 1/26/17.
 */
"use strict";

const fsp = require('fs-extra-p');

class Filestore {

}

function makeFs(base, target) {
    return Object.getOwnPropertyNames(base)
        .forEach(name => {
            //Let's make sure that, if fs uses `this` anywhere, we don't screw it up
            let bound = fsp[name].bind(fsp);
            let modified = bound;
            if (needsReplacing(name)) {
                modified = function() {
                    return bound(...arguments);
                }
            }
            target[name] = modified;
        });
}

const nameContents = ['copy', 'move', 'output', 'write', 'remove'];

function needsReplacing(name) {
    if (name.toLowerCase().indexOf('write') !== -1) {
        return true;
    }
}

module.exports = makeFs(fsp);



