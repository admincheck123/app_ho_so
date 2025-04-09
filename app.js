// app.js
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const session = require('express-session');

// Kết nối MongoDB
mongoose.connect('mongodb://localhost:27017/profilesDB', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const app = express();

// Cấu hình session: 10 phút
app.use(session({
  secret: 'my-secret-key', // thay bằng chuỗi bí mật của bạn
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 10 * 60 * 1000 }
}));

// --- MIDDLEWARE --- //
function isAuthenticated(req, res, next) {
  if (req.session && req.session.loggedIn) {
    req.session.cookie.expires = new Date(Date.now() + 10 * 60 * 1000);
    req.session.cookie.maxAge = 10 * 60 * 1000;
    return next();
  } else {
    res.redirect('/login');
  }
}

function isAdmin(req, res, next) {
  if (req.session && req.session.loggedIn && req.session.role === 'admin') {
    return next();
  }
  res.redirect('/login');
}

function isEmployee(req, res, next) {
  if (req.session && req.session.loggedIn && req.session.role === 'employee') {
    return next();
  }
  res.redirect('/login');
}

// --- MODELS --- //
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
  currentAmount: { type: Number, default: 0 },
  notes: { type: String, default: "" },
  amountHistory: [{
    type: { type: String, enum: ['add', 'subtract'] },
    amount: Number,
    reason: String,
    date: { type: Date, default: Date.now }
  }]
}, { timestamps: true }));

const Account = mongoose.model('Account', new mongoose.Schema({
  balance: { type: Number, default: 0 },
  history: [{
    type: { type: String, enum: ['add', 'subtract'] },
    amount: Number,
    reason: String,
    date: { type: Date, default: Date.now }
  }]
}));

const Employee = mongoose.model('Employee', new mongoose.Schema({
  username: { type: String, unique: true },
  password: String,
  name: String,
  accountNumber: String,
  avatar: String
}, { timestamps: true }));

const LoanRequest = mongoose.model('LoanRequest', new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  accountNumber: String,
  name: String,
  amount: Number,
  reason: String,
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
}));

// --- CONFIG --- //
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Multer cho upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Đếm pending loanRequests cho admin menu
app.use(async (req, res, next) => {
  if (req.session && req.session.role === 'admin') {
    try {
      res.locals.loanRequestCount = await LoanRequest.countDocuments({ status: 'pending' });
    } catch {
      res.locals.loanRequestCount = 0;
    }
  }
  next();
});

// --- ROUTES ĐĂNG NHẬP / ĐĂNG XUẤT --- //
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === '123456') {
    req.session.loggedIn = true;
    req.session.role = 'admin';
    req.session.cookie.expires = new Date(Date.now() + 10 * 60 * 1000);
    req.session.cookie.maxAge = 10 * 60 * 1000;
    return res.redirect('/list');
  }
  try {
    const employee = await Employee.findOne({ username, password });
    if (!employee) {
      return res.render('login', { error: 'Tên tài khoản hoặc mật khẩu không chính xác!' });
    }
    req.session.loggedIn = true;
    req.session.role = 'employee';
    req.session.employee = employee;
    req.session.cookie.expires = new Date(Date.now() + 10 * 60 * 1000);
    req.session.cookie.maxAge = 10 * 60 * 1000;
    res.redirect('/employee/create-loan-request');
  } catch {
    res.render('login', { error: 'Có lỗi xảy ra khi đăng nhập.' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// --- ROUTES ADMIN --- //

// Danh sách hồ sơ
app.get('/list', isAuthenticated, isAdmin, async (req, res) => {
  const search = req.query.search || "";
  const profiles = await Profile.find({ name: { $regex: search, $options: "i" } });
  const updatedProfiles = profiles.map(p => {
    const today = new Date();
    const returnDate = new Date(p.returnDate);
    let daysLeftText = 'Chưa rõ';
    if (!isNaN(returnDate)) {
      const days = Math.ceil((returnDate - today) / (1000*60*60*24));
      daysLeftText = days < 0 ? 'Đã hết hạn' : `${days} ngày còn lại`;
    }
    return { ...p.toObject(), daysLeftText };
  });
  let account = await Account.findOne() || await Account.create({});
  res.render('list', { profiles: updatedProfiles, account });
});

// Tạo NV
app.get('/admin/create-employee', isAuthenticated, isAdmin, (req, res) => {
  res.render('adminCreateEmployee', { error: null });
});
app.post('/admin/create-employee', isAuthenticated, isAdmin, upload.single('avatar'), async (req, res) => {
  try {
    const data = { ...req.body };
    if (req.file) data.avatar = req.file.filename;
    await Employee.create(data);
    res.redirect('/admin/employee-list');
  } catch {
    res.render('adminCreateEmployee', { error: 'Lỗi tạo nhân viên. Có thể username đã tồn tại.' });
  }
});

// Danh sách NV
app.get('/admin/employee-list', isAuthenticated, isAdmin, async (req, res) => {
  const employees = await Employee.find();
  res.render('adminEmployeeList', { employees });
});

// Sửa NV
app.get('/admin/employee-list/:id/edit', isAuthenticated, isAdmin, async (req, res) => {
  const emp = await Employee.findById(req.params.id);
  res.render('adminEditEmployee', { emp, error: null });
});
app.post('/admin/employee-list/:id/edit', isAuthenticated, isAdmin, upload.single('avatar'), async (req, res) => {
  try {
    const update = { ...req.body };
    if (req.file) {
      const old = await Employee.findById(req.params.id);
      if (old.avatar && fs.existsSync(`public/uploads/${old.avatar}`)) {
        fs.unlinkSync(`public/uploads/${old.avatar}`);
      }
      update.avatar = req.file.filename;
    }
    await Employee.findByIdAndUpdate(req.params.id, update);
    res.redirect('/admin/employee-list');
  } catch {
    res.redirect('/admin/employee-list');
  }
});

// Xóa NV
app.post('/admin/employee-list/:id/delete', isAuthenticated, isAdmin, async (req, res) => {
  const emp = await Employee.findById(req.params.id);
  if (emp.avatar && fs.existsSync(`public/uploads/${emp.avatar}`)) {
    fs.unlinkSync(`public/uploads/${emp.avatar}`);
  }
  await Employee.findByIdAndDelete(req.params.id);
  res.redirect('/admin/employee-list');
});

// Quản lý yêu cầu vay
app.get('/admin/loan-requests', isAuthenticated, isAdmin, async (req, res) => {
  const requests = await LoanRequest.find().populate('employeeId');
  res.render('adminLoanRequests', { requests });
});
app.post('/admin/loan-requests/:id/update', isAuthenticated, isAdmin, async (req, res) => {
  await LoanRequest.findByIdAndUpdate(req.params.id, { status: req.body.status });
  res.redirect('/admin/loan-requests');
});
app.get('/admin/loan-requests/count', async (req, res) => {
  const count = await LoanRequest.countDocuments({ status: 'pending' });
  res.json({ count });
});

// --- ROUTES NHÂN VIÊN --- //
app.get('/employee/create-loan-request', isAuthenticated, isEmployee, async (req, res) => {
  const employee = req.session.employee;
  const loanHistory = await LoanRequest.find({ employeeId: employee._id }).sort({ createdAt: -1 });
  res.render('employeeLoanRequest', { employee, error: null, loanHistory });
});
app.post('/employee/loan-request', isAuthenticated, isEmployee, async (req, res) => {
  try {
    const { amount, reason } = req.body;
    const emp = req.session.employee;
    await LoanRequest.create({
      employeeId: emp._id,
      accountNumber: emp.accountNumber,
      name: emp.name,
      amount, reason
    });
    res.redirect('/employee/loan-request-success');
  } catch {
    const loanHistory = await LoanRequest.find({ employeeId: req.session.employee._id }).sort({ createdAt: -1 });
    res.render('employeeLoanRequest', { employee: req.session.employee, error: 'Lỗi gửi yêu cầu.', loanHistory });
  }
});
app.get('/employee/loan-request-success', isAuthenticated, isEmployee, (req, res) => {
  res.render('employeeLoanRequestSuccess');
});

// --- ROUTES HỒ SƠ & CẤP CỨU --- //
app.get('/', (req, res) => res.render('index'));
app.get('/profile/:id', isAuthenticated, async (req, res) => {
  const profile = await Profile.findById(req.params.id);
  res.render('profile', { profile });
});
app.post('/add', upload.fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'images', maxCount: 5 }
]), async (req, res) => {
  const data = { ...req.body };
  data.avatar = req.files.avatar?.[0]?.filename || 'default-avatar.png';
  data.images = req.files.images?.map(f => f.filename) || [];
  await Profile.create(data);
  res.redirect('/list');
});
app.post('/edit/:id', upload.fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'images', maxCount: 5 }
]), async (req, res) => {
  const updated = { ...req.body };
  const profile = await Profile.findById(req.params.id);
  if (req.files.avatar) {
    if (profile.avatar && fs.existsSync(`public/uploads/${profile.avatar}`)) {
      fs.unlinkSync(`public/uploads/${profile.avatar}`);
    }
    updated.avatar = req.files.avatar[0].filename;
  }
  if (req.files.images) {
    profile.images.forEach(img => {
      if (fs.existsSync(`public/uploads/${img}`)) fs.unlinkSync(`public/uploads/${img}`);
    });
    updated.images = req.files.images.map(f => f.filename);
  }
  await Profile.findByIdAndUpdate(req.params.id, updated);
  res.redirect(`/profile/${req.params.id}`);
});
app.post('/update-account', async (req, res) => {
  const { amount, type, reason } = req.body;
  let account = await Account.findOne() || await Account.create({});
  const num = parseFloat(amount);
  if (!isNaN(num)) {
    account.balance += (type === 'add' ? num : -num);
    account.history.push({ type, amount: num, reason });
    await account.save();
  }
  res.redirect('/list');
});
app.post('/update-profile', upload.fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'images', maxCount: 10 }
]), async (req, res) => {
  try {
    const { name, address, email, phone, idcard, birthday, paid, notes } = req.body;
    const profile = req.body._id
      ? await Profile.findById(req.body._id)
      : await Profile.findOne({ phone });
    if (!profile) return res.status(404).send('Không tìm thấy hồ sơ.');

    profile.name = name || profile.name;
    profile.address = address || profile.address;
    profile.email = email || profile.email;
    profile.idcard = idcard || profile.idcard;
    profile.birthday = birthday || profile.birthday;
    profile.paid = paid === 'true';
    profile.notes = notes || profile.notes;

    if (req.files.avatar) {
      if (profile.avatar && fs.existsSync(`public/uploads/${profile.avatar}`)) {
        fs.unlinkSync(`public/uploads/${profile.avatar}`);
      }
      profile.avatar = req.files.avatar[0].filename;
    }
    if (req.files.images) {
      const newImgs = req.files.images.map(f => f.filename);
      profile.images = [...profile.images, ...newImgs];
    }

    await profile.save();
    res.redirect(`/profile/${profile._id}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Lỗi khi cập nhật hồ sơ.');
  }
});
app.get('/delete/:id', async (req, res) => {
  const profile = await Profile.findById(req.params.id);
  if (profile) {
    if (profile.avatar && fs.existsSync(`public/uploads/${profile.avatar}`)) {
      fs.unlinkSync(`public/uploads/${profile.avatar}`);
    }
    profile.images.forEach(img => {
      if (fs.existsSync(`public/uploads/${img}`)) fs.unlinkSync(`public/uploads/${img}`);
    });
    await Profile.findByIdAndDelete(req.params.id);
  }
  res.redirect('/list');
});

// Khởi động server
app.listen(3000, () => {
  console.log('Server đang chạy tại http://localhost:3000');
});
