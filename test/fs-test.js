var fs = require("../lib/RiakFS");
fs.init({name: "test"});

var cb = console.log.bind(console);
fs.exists("view/test.sprt", function (exists) {
	console.log("EXISTS", exists);

	if (exists) {
		fs.readFile("view/test.sprt", function  (err, data) {
			console.log("READFILE", err, data);
			fs.unlink("view/test.sprt", cb);
		});

		fs.readdir("view", function (err, list) {
			console.log("READDIR", err, list);
		})
	} else {
		
		fs.writeFile("view/test.sprt", "BLAH", cb);
	}
});




//fs.readdir("views", cb);