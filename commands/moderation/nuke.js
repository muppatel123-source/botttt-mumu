module.exports = {
  name: 'nuke',
  description: 'Deletes and recreates the channel to clear all messages',
  async execute(message) {
    if (!message.member.permissions.has('Administrator')) return;

    const channel = message.channel;
    const position = channel.position;

    // 1. Clone the channel (keeps permissions, slowmode, etc.)
    const newChannel = await channel.clone();
    
    // 2. Move it to the same spot
    await newChannel.setPosition(position);
    
    // 3. Delete the old one
    await channel.delete();

    // 4. Send the "Nuke" message in the new channel
    newChannel.send("<a:Nukes:1486767479379464253> **Channel Nuked.** All messages have been cleared.");
    
    // Optional: Send a GIF or embed
    newChannel.send("https://tenor.com/view/explosion-mushroom-cloud-atomic-bomb-bomb-boom-gif-16021932").then(m => {
        setTimeout(() => m.delete(), 5000); // Deletes the GIF after 5s to keep it clean
    });
  },
};