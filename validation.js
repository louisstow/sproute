var _ = require("underscore");

exports.test = function (value, rule) {
	var errors = [];

	console.log(value, rule);

	//only validate the type
	if (typeof rule === "string" || rule.type) {
		var type = (rule.type || rule).toLowerCase();

		if (typeof value !== type) {
			errors.push("Expected "+type+", got "+(typeof value));
		}

		return errors;
	}

	//list of accepted values
	if (rule.values) {
		if (rule.values.indexOf(value) === -1)
			errors.push("Value ("+value+") did not exist in [" + rule.values.join(", ") + "]");
	}

	//maximum length of string or array
	if (rule.maxlen) {
		if (value.length > rule.maxlen)
			errors.push("Exceeded maximum length of "+rule.maxlen+", got "+value.length);
	}

	//minimum length of string or array
	if (rule.minlen) {
		if (value.length > rule.minlen)
			errors.push("Exceeded minimum length of "+rule.minlen+", got "+value.length);
	}

	//minimum value for Number
	if (rule.min) {
		if (value < rule.min)
			errors.push("Value less than the minimum of "+rule.min+", got "+value);
	}

	//maximum value for Number
	if (rule.max) {
		if (value > rule.max)
			errors.push("Value greater than the maximum of "+rule.max+", got "+value);
	}

	return errors;
}