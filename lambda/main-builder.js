/**
 * Created by ThatJoeMoore on 2/8/17
 */
"use strict";

const configLoader = require('../lib/main-config-loader');

const runner = require('../runner');

/**
 *
 * @param {BuildRequest} incoming
 * @param context
 * @param callback
 */
exports.handler = function(incoming, context, callback) {
    configLoader().then(libs => runner(libs))
        .then(() => console.log('Finished Run'))
        .then(() => callback(null, {ran: true}))
        .catch(err => {
            console.error('Build Error', err, err.stack);
            callback(err);
        });
};