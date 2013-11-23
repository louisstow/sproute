var PageController = Spineless.View.extend({
	template: [
		{className: "new", children: [
			{tag: "label", children: [
				{tag: "span", text: "Page Name: "},
				{tag: "input", id: "name"}
			]},

			{tag: "label", children: [
				{tag: "textarea", id: "content"}
			]},

			{tag: "button", id: "submit", type: "submit", text: "Create Page"}
		]},
		{id: "list"}
	],

	events: {
		"click submit": "onSubmit"
	},

	defaults: {
		"name": "",
		"content": ""
	},

	init: function () {
		Page.super(this, "init", arguments);

		this.sync("get", "/admin/views");
		this.once("sync:get", this.onViews);

		this.on("selected", this.onSelect);
	},

	onViews: function (views) {
		for (var i = 0; i < views.length; ++i) {
			this.addChild(new Page({
				superview: this.list,
				view: views[i]
			}));
		}
	},

	onSubmit: function () {
		this.post("/admin/views");
		this.once("sync:post", function (resp) {
			console.log("POST", this.model.name)
			
			//exists already
			if (this.find({name: this.model.name})) {
				return;
			}

			this.addChild(new Page({
				superview: this.list,
				view: this.model.name + ".sprt"
			}));
		});
	},

	onSelect: function (view) {
		var id = this.sync("get", "/admin/views/" + view);
		this.set("name", view);

		this.on("sync:" + id, function (resp) {
			console.log(resp)
			this.set("content", resp)
		});
	}
});

var Page = Spineless.View.extend({
	defaults: {
		view: null
	},

	template: [
		{id: "name"},
		{id: "cancel", tag: "button", text: "X"}
	],

	events: {
		"click name": "onClick",
		"click cancel": "onCancel"
	},

	onClick: function () {
		var n = this.model.view.substring(0, this.model.view.lastIndexOf(".sprt"))
		this.emit("selected", n);
	},

	onCancel: function () {
		var id = this.delete("/admin/views/" + this.model.view);
		this.once(id, this.removeFromParent);
	},

	render: function () {
		var n = this.model.view.substring(0, this.model.view.lastIndexOf(".sprt"))
		this.name.textContent = n;
	}
});

$(".page").click(function () {
	if (p) {
		p.removeFromParent();
	}

	p = new PageController({
		superview: "page"
	});	
})
