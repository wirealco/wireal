const { read, write } = require("./record.cjs");

read((payload) => {
  write(
    process.argv[2] ||
      (typeof payload.hook_event_name === "string"
        ? payload.hook_event_name
        : "hook"),
    payload,
  );
});
