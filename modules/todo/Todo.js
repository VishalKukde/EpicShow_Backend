import mongoose from 'mongoose';

const todoSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    completed: {
        type: Boolean,
        default: false
    },

}, { timestamps: true });

// Mongoose will:
// 👉 take model name Todo
// 👉 pluralize it
// 👉 lowercase it
// So it creates: 📁 todos collection

// export default mongoose.model('Todo', todoSchema);
