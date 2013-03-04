
var entityMap = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': '&quot;',
    "'": '&#39;',
    "/": '&#x2F;'
};

var tagRx = /{{([^}}]+)}}/g;
var _slice = Array.prototype.slice;

function escapeHtml (string) {
    return String(string).replace(/[&<>"'\/]/g, function (s) {
        return entityMap[s];
    });
}

exports.toJSON = function (adt) {
    return JSON.stringify(adt, null, '\t');
}

//global compiled variable
//due to easier recursion handling
var compiled = "";

/**
* Parse template char by char
* look for {{
    * parse the expression
    * save the inner html
    * save the start and end char points in template
* look for }}
*/
exports.render = function (template, data) {
    compiled = "";
    var tokens = tokenize(template);
    
    link(template, tokens, data, 0);

    console.log(exports.toJSON(tokens))
    console.log(pieces)
    console.log(pieces.join(""));
}

var types = {
    "VAR": "var",
    "CONDITION": "condition",
    "LOOP": "loop"
};

/**
* [
    {type: "condition", start: 6, end: 20, t: [], f: []}
* ]
*/
function tokenize (template) {
    //flags to keep track of
    //open expressions
    var openTag = -1;
    var openCondition = []; //stack
    var openLoop = []; //stack

    var tokens = [];
    var parent = tokens;

    //loop over every fucking character :\
    for (var idx = 0; idx < template.length; ++idx) {
        var char = template[idx];

        //open tag
        if (char === '{') {
            //already open
            if (openTag !== -1) {
                console.error("|", template.substring(openTag, idx));
                throw "Tag already open";
            }

            openTag = idx;
        }

        //closedTag
        if (char === '}') {
            if (openTag === -1) {
                throw new TokenError("Tag not opened at", idx)
            }

            //grab the expression from last open tag
            var expression = template.substring(openTag + 1, idx).trim();
            console.log("expr:", expression);

            var token =  {};
            parent.push(token);

            //a conditional statement
            if (expression.substr(0, 2).toLowerCase() === "if") {
                token.type = types.CONDITION;
                token.expr = expression.substr(3);
                token.startTrue = idx + 1;
                token.start = openTag;
                
                //nested template blocks
                token.onTrue = [];
                token.onFalse = [];

                //push the current condition
                //on the stack
                openCondition.push(token);
                token.parent = parent;

                //subsequent blocks fall under this
                parent = token.onTrue;
            }
            //an else statement
            else if (expression.toLowerCase() === "else") {
                token.skipFrom = openTag;
                token.skipTo = idx + 1;
                token.type = "else";
                var lastCondition = openCondition.pop();
                
                //save pointers to the start and end
                //of the else
                lastCondition.endTrue = openTag;
                lastCondition.startFalse = idx + 1;
                lastCondition.else = true;

                parent = lastCondition.onFalse;
                openCondition.push(lastCondition);
            }
            //loop
            else if (expression.substr(0, 4).toLowerCase() === "each") {
                token.type = types.LOOP;
                token.startLoop = idx + 1;
                token.start = openTag;
                token.loop = [];

                //parse the loop expression
                var eachOptions = expression.substr(5).split(/[\s,]+/);
                token.list = eachOptions[0];
                token.iterator = eachOptions[2];
                if (eachOptions.length === 4) { 
                    token.index = eachOptions[3]; 
                }

                console.log(eachOptions);

                openCondition.push(token);
                token.parent = parent;
                parent = token.loop;
            }
            //close the last expression
            else if (expression[0] === '/') {
                //skip the entire tag
                token.skipFrom = openTag;
                token.skipTo = idx + 1;

                //need to swap the parent
                //to the parent of the last condition
                var lastCondition = openCondition.pop();

                //save a pointer to the end of condition
                if (lastCondition.else) { lastCondition.endFalse = idx + 1; }
                else { lastCondition.endTrue = idx + 1; }

                parent = lastCondition.parent;
                delete lastCondition.parent;
            }
            //placeholder
            else {
                token.type = types.VAR;
                token.start = openTag + 1;
                token.end = idx;
                token.placeholder = expression;
            }

            //reset open tag flag
            openTag = -1;
        }
    }

    return tokens;
}

/**
* 1. Compile to `compiled`
* 2. When rendering placeholder... do something
* 3. 
*/
var pieces = [];

function link (template, adt, data, start) {
    var originalStart = start;

    for (var i = 0; i < adt.length; ++i) {
        var block = adt[i];

        //skip if an empty block
        if (block.skipFrom) {
            pieces.push(template.substring(start, block.skipFrom));
            start = block.skipTo;
            continue; 
        }

        console.log("TYPE", block.type, block.expr || block.placeholder)        
        switch (block.type) {

            case types.VAR: 
                var value = data[block.placeholder];
                console.log(block.placeholder, "=", value)

                pieces.push(template.substring(start, block.start - 1))
                pieces.push(value);
                start = block.end + 1;

                console.log("var start", start)
                break;
            
            case types.CONDITION:
                pieces.push(template.substring(start, block.start));

                //if the expressions evaluates to
                //true, execute the onTrue blocks
                if (data[block.expr]) {
                    console.log("EVALUETE", data[block.expr])
                    
                    if (block.onTrue) {
                        link(template, block.onTrue, data, block.startTrue);
                    }
                } else {
                    console.log("FUCK THE WHAT?")

                    if (block.onFalse && block.else) {
                        link(template, block.onFalse, data, block.startFalse);
                    }
                }

                if (block.else) { start = block.endFalse; }
                else { start = block.endTrue; }

                console.log("cond start", start)
                break;

            case types.LOOP:
                pieces.push(template.substring(start, block.start));

                var list = data[block.list];

                for (var j = 0; j < list.length; ++j) {
                    data[block.iterator] = list[j];
                    data[block.index] = j;
                    console.log("YO", data[list.iterator], list[j], list.iterator)

                    link(template, block.loop, data, block.startLoop);
                }

                start = block.endTrue;

                break;
        }
    }

    //add the last of the template if this was the
    //original link call
    if (originalStart === 0) {
        pieces.push(template.substring(start, template.length));
    }
    
}