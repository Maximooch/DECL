module.exports = {
    name: "ping",
    description: "Replies with pong",

    execute(message) {
        message.reply("Pong!");
    }
};