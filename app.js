const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const session = require('express-session');

const app = express();

// Kết nối MongoDB
mongoose.connect('mongodb://localhost:27017/profilesDB', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Cấu hình session: thời gian hết hạn 10 phút
app.use(session({
  secret: 'my-secret-key', // nên thay bằng chuỗi bí mật của riêng bạn
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 10 * 60 * 1000 } // 10 phút
}));

// --- MODELS --- //

// Model hồ sơ khách hàng (Profile)
// Đã thêm trường "notes" để lưu ghi chú của hồ sơ
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
  currentAmount: {
    type: Number,
    default: 0,
  },
  notes: {
    type: String,
    default: ""
  },
  amountHistory: [
    {
      type: {
        type: String,
        enum: ['add', 'subtract']
      },
      amount: Number,
      reason: String,
      date: { type: Date, default: Date.now }
    }
  ]
}, { timestamps: true }));

// Model Tài khoản (Account) – số tiền tài khoản toàn cục và lịch sử giao dịch
const Account = mongoose.model('Account', new mongoose.Schema({
  balance: { type: Number, default: 0 },
  history: [{
    type: { type: String, enum: ['add', 'subtract'] },
    amount: Number,
    reason: String,
    date: { type: Date, default: Date.now }
  }]
}));

// --- END MODELS --- //

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Cấu hình lưu ảnh với multer
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

// --- MIDDLEWARE BẢO VỆ TRANG --- //
function isAuthenticated(req, res, next) {
  if (req.session && req.session.loggedIn) {
    // Nếu session đã đăng nhập, reset lại thời gian hết hạn cookie
    req.session.cookie.expires = new Date(Date.now() + 10 * 60 * 1000);
    req.session.cookie.maxAge = 10 * 60 * 1000;
    return next();
  } else {
    res.redirect('/login');
  }
}

// --- ROUTES ĐĂNG NHẬP / ĐĂNG XUẤT --- //
// Trang đăng nhập
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

// Xử lý đăng nhập
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  // Kiểm tra username và password
  if (username === 'admin' && password === '123456') {
    req.session.loggedIn = true;
    // Thiết lập thời gian đăng nhập cho 10 phút
    req.session.cookie.expires = new Date(Date.now() + 10 * 60 * 1000);
    req.session.cookie.maxAge = 10 * 60 * 1000;
    res.redirect('/list');
  } else {
    res.render('login', { error: 'Tên tài khoản hoặc mật khẩu không chính xác!' });
  }
});

// Route đăng xuất
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// --- ROUTES CÓ BẢO VỆ --- //
app.get('/list', isAuthenticated, async (req, res) => {
  const search = req.query.search || "";
  const profiles = await Profile.find({
    name: { $regex: search, $options: "i" }
  });
  const updatedProfiles = profiles.map(profile => {
    const today = new Date();
    const loanDate = new Date(profile.loanDate);
    const returnDate = new Date(profile.returnDate);
    let statusMessage = 'Chưa rõ';
    if (!isNaN(returnDate.getTime()) && !isNaN(loanDate.getTime())) {
      const diffTime = returnDate - today;
      const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      statusMessage = daysLeft < 0 ? 'Đã hết hạn' : `${daysLeft} ngày còn lại`;
    }
    return {
      ...profile.toObject(),
      daysLeftText: statusMessage
    };
  });
  let account = await Account.findOne({});
  if (!account) account = await Account.create({});
  res.render('list', { profiles: updatedProfiles, account });
});

app.get('/profile/:id', isAuthenticated, async (req, res) => {
  const profile = await Profile.findById(req.params.id);
  res.render('profile', { profile });
});

// Các route khác (index, add, edit, update-account, update-profile, delete) vẫn không cần bảo vệ nếu bạn chỉ muốn bảo vệ /list và /profile.
// Bạn có thể áp dụng middleware isAuthenticated cho các route cần bảo vệ theo ý muốn.

// Trang index vẫn được truy cập công khai
app.get('/', (req, res) => {
  res.render('index');
});

// --- Các Route hồ sơ cũ --- //

app.post('/add', upload.fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'images', maxCount: 5 }
]), async (req, res) => {
  const { name, address, phone, birthday, idcard, email,
          loanAmount, loanDate, returnDate, interestRate, interestEarned, notes } = req.body;
  const avatar = req.files['avatar']?.[0]?.filename || 'default-avatar.png';
  const images = req.files['images']?.map(file => file.filename) || [];
  await Profile.create({
    name,
    address,
    phone,
    birthday,
    idcard,
    email,
    loanAmount,
    loanDate,
    returnDate,
    interestRate,
    interestEarned,
    avatar,
    images,
    notes
  });
  res.redirect('/list');
});

app.post('/edit/:id', upload.fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'images', maxCount: 5 }
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
  updated.notes = req.body.notes || profile.notes;
  await Profile.findByIdAndUpdate(req.params.id, updated);
  res.redirect("/profile/" + req.params.id);
});

app.post('/update-account', async (req, res) => {
  const { amount, type, reason } = req.body;
  let account = await Account.findOne({});
  if (!account) account = await Account.create({});
  const numericAmount = parseFloat(amount);
  if (isNaN(numericAmount)) return res.status(400).send('Số tiền không hợp lệ.');
  if (type === 'add') {
    account.balance += numericAmount;
  } else if (type === 'subtract') {
    account.balance -= numericAmount;
  }
  account.history.push({ type, amount: numericAmount, reason });
  await account.save();
  res.redirect('/list');
});

app.post('/update-profile', upload.fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'images', maxCount: 10 }
]), async (req, res) => {
  try {
    const { name, address, email, phone, idcard, birthday, paid, notes } = req.body;
    let profile;
    if (req.body._id) {
      profile = await Profile.findById(req.body._id);
    } else {
      profile = await Profile.findOne({ phone });
    }
    if (!profile) return res.status(404).send('Không tìm thấy hồ sơ.');
    profile.name = name || profile.name;
    profile.address = address || profile.address;
    profile.email = email || profile.email;
    profile.idcard = idcard || profile.idcard;
    profile.birthday = birthday || profile.birthday;
    profile.paid = paid === 'true';
    profile.notes = notes || profile.notes;
    if (req.files && req.files['avatar']) {
      const avatarFile = req.files['avatar'][0];
      const oldAvatarPath = path.join(__dirname, 'public', 'uploads', profile.avatar || '');
      if (profile.avatar && fs.existsSync(oldAvatarPath)) {
        fs.unlinkSync(oldAvatarPath);
      }
      profile.avatar = avatarFile.filename;
    }
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
    if (profile.avatar && fs.existsSync(`public/uploads/${profile.avatar}`)) {
      fs.unlinkSync(`public/uploads/${profile.avatar}`);
    }
    profile.images.forEach(file => {
      const filePath = `public/uploads/${file}`;
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
    await Profile.findByIdAndDelete(req.params.id);
  }
  res.redirect('/list');
});

app.listen(3000, () => {
  console.log('Server đang chạy tại http://localhost:3000');
});
