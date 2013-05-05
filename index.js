//import npm modules
var express = require("express");
var server = express();
require("./config/express")(server);

var ff = require("ff");
var fs = require("fs");
var path = require("path");
var _ = require("underscore");

var appName = "myblog";
var dir = "example";

var App = require("./app");
var app = new App(appName, dir, server);

server.listen(8089);