debugger;
var a = "hay [[third doc]] [\\[hi]\\]";
console.log(a);
console.log(parseTags(a,function(s) {return ' dog ';}));

function parseTags(string,callback) {

  function Tag(start) {
    this.start = start;
    this.text = "";
    this.length = 0;
  }

  var tags = [];
  var state = 0;
  var curtagid = -1;

  for (var i=0; i<string.length; i++) {
    switch (state) {
      case -1: //outside tag and backslashed
        console.log("state -1 i:"+i);
        state = 0;
        break;
      case 0: //outside tag
        console.log("state 0 i:"+i);
        switch (string.charAt(i)) {
          case '[':
            state = 1;
            break;
          case '\\':
            state = -1;
            break;
        }
        break;
      case 1: //halfway inside tag
        console.log("state 1 i:"+i);
        if (string.charAt(i) === '[') {state = 2; tags.push(new Tag(i-1));}
        else {state = 0;}
        break;
      case 2: //inside tag
        console.log("state 2 i:"+i);
        if (string.charAt(i) === '\\') {state = 3;}
        else if (string.charAt(i) === ']') {state = 4;}
        else {tags[tags.length-1].text += string.charAt(i);}
        break;
      case 3: //inside tag backslashed

        console.log("state 3 i:"+i);
        console.log("test"+i);
        state = 2;
        tags[tags.length-1].text += string.charAt(i);
        break;
      case 4: //first exit ]

        console.log("state 4 i:"+i);
        if (string.charAt(i) === ']') {tags[tags.length-1].length = i-tags[tags.length-1].start+1; state = 0;}
        else if (string.charAt(i) === '\\') {tags[tags.length-1].text += string.charAt(i-1); state=3;}
        else {tags[tags.length-1].text += string.charAt(i-1)+string.charAt(i); state=2;}
        break;
    }
  }

  var newstring = "";
  var lastpos = 0;
  tags.forEach(function(tag) {
    var replacement = callback(tag.text);
    console.log(lastpos + " " + tag.start + " " + tag.length + " " +tag.text);
    newstring += string.substring(lastpos,tag.start) + replacement;
    lastpos = tag.start+tag.length;
  });
  newstring += string.substring(lastpos);

  return newstring;
}


// a = "#tag1 #tag2    #tag3";
// console.log(a.split(' '));


// microposts.forEach( function(micropost) {

//   // display other post stuff here

//   <h4> <% micropost.tags.split(' ').forEach( function(tag) { %>
//     if (tag !== '') {
//       <a href="<%= %>"> ... </a>
//     }
//   }); 
// });