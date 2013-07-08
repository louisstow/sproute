var util = require("util");
var dateformat = require("dateformat");

module.exports = {
	asset: function (block, next) {
		var filename = block.expr;
		var ext = filename.substr(filename.lastIndexOf(".") + 1).toLowerCase();
		var template;

		if (ext === "css") {
			template = "<link href='%s' rel='stylesheet' type='text/css' />";
		}
		else if (ext === "js") {
			template = "<script src='%s' type='text/javascript'></script>";
		}

		//put the rendered HTML back into the view
		this.pieces.push(util.format(template, filename));
		next();
	},

	date: function (block, next) {
		var opts = block.expr.split(" ");
		var d = new Date(+opts[0]);
		var format = opts.slice(1).join(" ");
		
		this.pieces.push(dateformat(d, format));
		next();
	}
};