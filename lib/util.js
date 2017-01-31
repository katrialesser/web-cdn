/**
 * Created by jmooreoa on 1/25/17.
 */
"use strict";

const semver = require('semver');

module.exports = {
    cleanRefName: cleanRefName,
    transformObject: transformObject,
    writeObjectPath: writeObjectPath
};


function cleanRefName(name) {
    let clean = semver.clean(name);
    return clean ? clean : name;
}

function transformObject(obj, func) {
    return Object.getOwnPropertyNames(obj)
        .reduce((result, prop) => {
                result[prop] = func(prop, obj[prop]);
                return result;
            },
            {}
        );
}

function writeObjectPath(obj, value, pathParts) {
    let current = pathParts[0];
    if (pathParts.length > 1) {
        let next = obj[current] = obj[current] || {};
        writeObjectPath(next, value, pathParts.slice(1));
    } else {
        obj[current] = value;
    }
}
