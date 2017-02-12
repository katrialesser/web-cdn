/**
 * Created by ThatJoeMoore on 2/8/17
 */
"use strict";

/**
 *
 * @type {BuildRequest}
 */
module.exports = class BuildRequest {

    /**
     *
     * @param {Source} source
     * @param {?User} user
     * @param {boolean} [forcePush=false]
     */
    constructor(source, user, forcePush) {
        this.source = source;
        this.user = user;
        //noinspection PointlessBooleanExpressionJS
        this.forcePush = !!forcePush;
    }

    static Source = {
        MANUAL: 'manual',
        GITHUB_PUSH: 'github-push'
    };

    static UserType = {
        BYU: 'byu',
        GITHUB: 'github'
    };

    static User = class User {
        /**
         *
         * @param {UserType} type
         * @param {string} id
         * @param {string} name
         * @param {string} email
         */
        constructor(type, id, name, email) {
            this.type = type;
            this.id = id;
            this.name = name;
            this.email = email;
        }
    }
};