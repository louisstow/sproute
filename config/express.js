var express = require("express");
var path = require("path");

module.exports = function (app) {
    var SECRET = "i love you";
    /**
    * Initialise Express
    */
    app.use(express.cookieParser(SECRET));
    app.use(express.session({secret: SECRET, cookie: {maxAge: null}}));

    app.use(express.static("./public", { maxAge: 1 }));
    app.use(express.bodyParser());

    app.use(function (req, res, next) {
        //misc middleware
        next();
    });
}