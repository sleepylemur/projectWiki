function a(s,f) {
  f("!"+s+"?");
}

function b() {
  console.log(arguments);
}

a("hi", b.bind(null,1,2));