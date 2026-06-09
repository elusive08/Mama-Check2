const mongoose = require('mongoose');

const mongoURI = process.env.MONGODB_URI || "mongodb://localhost:27017/mamacheck";

async function checkDatabase() {
  try {
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB');

    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
    const Pregnancy = mongoose.model('Pregnancy', new mongoose.Schema({}, { strict: false }));

    const users = await User.find({}, 'name phone').lean();
    console.log('--- Users ---');
    console.log(JSON.stringify(users, null, 2));

    const targetPhone = '08134490997';
    const targetUser = await User.findOne({ phone: targetPhone }).lean();
    if (targetUser) {
        console.log(\`User with phone \${targetPhone} found.\`);
    } else {
        console.log(\`User with phone \${targetPhone} NOT found.\`);
    }

    const pregnancies = await Pregnancy.find({}).lean();
    console.log('--- Pregnancies (linked woman IDs) ---');
    pregnancies.forEach(p => {
        console.log(\`Pregnancy ID: \${p._id}, Woman ID: \${p.womanId}\`);
    });

    // Check which users have pregnancies
    const usersWithPregnancies = users.map(u => {
        const hasPregnancy = pregnancies.some(p => p.womanId && p.womanId.toString() === u._id.toString());
        return { ...u, hasPregnancy };
    });

    console.log('--- User Pregnancy Status ---');
    console.log(JSON.stringify(usersWithPregnancies, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await mongoose.disconnect();
  }
}

checkDatabase();
