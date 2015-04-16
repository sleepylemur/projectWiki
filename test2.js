var marked = require('marked');

var a = "here is <strong>some</strong> <p>_text_</p>\n"+
"---\n"+
"<img src='imgurl'>\n"+
"---\n"+
"dogs";
console.log(marked(a));