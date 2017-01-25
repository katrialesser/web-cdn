/**
 * Created by jmooreoa on 1/25/17.
 */
"use strict";

const semver = require('semver');

module.exports = {
    cleanRefName: cleanRefName
};


function cleanRefName(name) {
    let clean = semver.clean(name);
    return clean ? clean : name;
}

