const { read, write } = require("./record.cjs");

read((payload) => {
  write("statusline", payload);
  process.stdout.write("\n");
});
