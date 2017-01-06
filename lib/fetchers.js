/**
 * Created by jmooreoa on 1/5/17.
 */
const req = require('request-promise-native').defaults({
    headers: {'User-Agent': 'BYU-Web-Community-CDN 1.0.0-dev'}
});


exports.GithubFetcher = class {
    constructor(source) {
        this.source = source;
        this._baseUrl = `https://api.github.com/repos/${source}`;
    }

    /**
     * @return Promise<string[]>
     */
    availableVersions() {
        let releases = req(`${this._baseUrl}/releases`)
            .then(data =>{
                let rels = JSON.parse(data);
                return rels.map(each => unV(each['tag_name']));
            });
        let tags = req(`${this._baseUrl}/tags`)
            .then(data =>{
                let tags = JSON.parse(data);
                return tags.map(each => unV(each['name']));
            });
        let branches = req(`${this._baseUrl}/branches`)
            .then(data => {
                let branches = JSON.parse(data);
                return branches.map(each => '#' + each['name']);
            });
        return Promise.all([releases, tags, branches])
            .then(function (results) {
                return Array.from(results.reduce(
                    (set, group) => {
                        group.forEach(each => set.add(each));
                        return set;
                    },
                    new Set()
                ));
            });
    }

    fetchVersion(version, destination) {

    }
};

function unV(versionString) {
    "use strict";
    if (versionString.toLowerCase().indexOf('v') === 0) {
        return versionString.substring(1);
    }
    return versionString;
}


