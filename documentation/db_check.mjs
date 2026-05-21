import mongoose from 'mongoose';
const mongoURI = 'mongodb://localhost:27017/mamacheck';
mongoose.connect(mongoURI).then(async () => {
const User = mongoose.model('User', new mongoose.Schema({}, {strict:false}));
const u = await User.find({}, 'name phone');
console.log(JSON.stringify(u));
process.exit(0); });
