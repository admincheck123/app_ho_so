const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

mongoose.connect('mongodb://localhost:27017/profilesDB', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const Profile = mongoose.model('Profile', new mongoose.Schema({
  name: String,
  address: String,
  phone: String,
  birthday: String,
  idcard: String,
  email: String,
  loanAmount: Number,
  loanDate: String,
  returnDate: String,
  interestRate: Number,
  interestEarned: Number,
  avatar: String,
  images: [String],
  paid: Boolean,
}, { timestamps: true }));

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// ✅ Cấu hình lưu ảnh
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/');
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + ext);
  }
});
const upload = multer({ storage });

app.get('/', (req, res) => {
  res.render('index');
});

app.post('/add', upload.fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'images', maxCount: 5 },
]), async (req, res) => {
  const {
    name, address, phone, birthday, idcard, email,
    loanAmount, loanDate, returnDate, interestRate, interestEarned
  } = req.body;

  const avatar = req.files['avatar']?.[0]?.filename || '';
  const images = req.files['images']?.map(file => file.filename) || [];

  await Profile.create({
    name, address, phone, birthday, idcard, email,
    loanAmount, loanDate, returnDate, interestRate, interestEarned,
    avatar, images
  });

  res.redirect('/list');
});

app.get('/list', async (req, res) => {
  const search = req.query.search || "";
  const profiles = await Profile.find({
    name: { $regex: search, $options: "i" },
  });
  // Thêm thông tin số ngày còn lại hoặc hết hạn
  const updatedProfiles = profiles.map(profile => {
    const today = new Date();
    const loanDate = new Date(profile.loanDate);
    const returnDate = new Date(profile.returnDate);

    let statusMessage = 'Chưa rõ';

    if (!isNaN(returnDate.getTime()) && !isNaN(loanDate.getTime())) {
      const diffTime = returnDate - today;
      const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      statusMessage = daysLeft < 0
        ? 'Đã hết hạn'
        : `${daysLeft} ngày còn lại`;
    }

    return {
      ...profile.toObject(), // chuyển Mongoose Document sang object thường
      daysLeftText: statusMessage
    };
  });

  res.render('list', { profiles: updatedProfiles });
});

app.get('/profile/:id', async (req, res) => {
  const profile = await Profile.findById(req.params.id);
  res.render('profile', { profile });
});

app.get('/edit/:id', async (req, res) => {
  const profile = await Profile.findById(req.params.id);
  res.render('edit', { profile });
});

app.post('/edit/:id', upload.fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'images', maxCount: 5 },
]), async (req, res) => {
  const updated = req.body;
  const profile = await Profile.findById(req.params.id);

  if (req.files.avatar) {
    if (profile.avatar && fs.existsSync(`public/uploads/${profile.avatar}`)) {
      fs.unlinkSync(`public/uploads/${profile.avatar}`);
    }
    updated.avatar = req.files.avatar[0].filename;
  } else {
    updated.avatar = profile.avatar;
  }

  if (req.files.images) {
    profile.images.forEach(img => {
      const imgPath = `public/uploads/${img}`;
      if (fs.existsSync(imgPath)) {
        fs.unlinkSync(imgPath);
      }
    });
    updated.images = req.files.images.map(f => f.filename);
  } else {
    updated.images = profile.images;
  }

  await Profile.findByIdAndUpdate(req.params.id, updated);
  res.redirect("/profile/" + req.params.id);
});

// ✅ ✅ ✅ Đã sửa lại đoạn /update-profile như bạn yêu cầu
app.post('/update-profile', upload.fields([
    { name: 'avatar', maxCount: 1 },
    { name: 'images', maxCount: 10 }
  ]), async (req, res) => {
    try {
      const { name, address, email, phone, idcard, birthday, paid } = req.body;
      const profile = await Profile.findOne({ phone });
  
      if (!profile) return res.status(404).send('Không tìm thấy hồ sơ.');
  
      // Cập nhật các trường cơ bản
      profile.name = name || profile.name;
      profile.address = address || profile.address;
      profile.email = email || profile.email;
      profile.idcard = idcard || profile.idcard;
      profile.birthday = birthday || profile.birthday;
  
      // Checkbox thanh toán
      profile.paid = paid === 'true';

  
      // Avatar
      if (req.files && req.files['avatar']) {
        const avatarFile = req.files['avatar'][0];
        const oldAvatarPath = path.join(__dirname, 'public', 'uploads', profile.avatar || '');
        if (profile.avatar && fs.existsSync(oldAvatarPath)) {
          fs.unlinkSync(oldAvatarPath);
        }
        profile.avatar = avatarFile.filename;
      }
  
      // Ảnh khác
      if (req.files && req.files['images']) {
        const imageFiles = req.files['images'].map(file => file.filename);
        profile.images = [...(profile.images || []), ...imageFiles];
      }
  
      profile.updatedAt = new Date();
      await profile.save();
  
      res.redirect('/profile/' + profile._id);
  
    } catch (error) {
      console.error('Lỗi khi cập nhật hồ sơ:', error);
      res.status(500).send('Có lỗi xảy ra khi cập nhật hồ sơ.');
    }
  });

  app.get('/delete/:id', async (req, res) => {
    const profile = await Profile.findById(req.params.id);
    if (profile) {
      // Xóa ảnh đại diện
      if (profile.avatar && fs.existsSync(`public/uploads/${profile.avatar}`)) {
        fs.unlinkSync(`public/uploads/${profile.avatar}`);
      }
  
      // Xóa ảnh minh họa
      profile.images.forEach(file => {
        const filePath = `public/uploads/${file}`;
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      });
  
      // Xóa hồ sơ khỏi cơ sở dữ liệu
      await Profile.findByIdAndDelete(req.params.id);
    }
    res.redirect('/list');  // Sau khi xóa, chuyển hướng đến trang danh sách
  });

app.listen(3000, () => {
  console.log('Server đang chạy tại http://localhost:3000');
});
