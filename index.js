"use strict";

const runner = require('./runner');
const yaml = require('node-yaml');

//Read the main config
yaml.readPromise('./main-config.yml')
    //Now run it!
    .then(config => runner(config));

