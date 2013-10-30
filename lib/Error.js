function Error (err) {
	this.template = [];

	this.parse(err);
}

Error.prototype = {
	parse: function (err) {
		if (typeof err === "string") {
			this.template.push({
				message: err
			});
		} else if (Array.isArray(err)) {
			for (var i = 0; i < err.length; ++i) {
				this.parse(err[i]);
			}
		} else if (typeof err === "object") {
			this.template.push({
				message: err.message,
				code: err.code,
				stack: err.stack
			});
		}
	},

	toJSON: function () {
		return JSON.stringify(this.template);
	}
};

module.exports = Error;