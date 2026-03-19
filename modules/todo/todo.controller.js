// const Todo = require("../models/Todo");


// exports.createTodo = async (req, res, next) => {
//     try {
//         const todo = await Todo.create(req.body);
//         res.status(201).json(todo);
//     }
//     catch (error) {
//         next(error);
//     }
// }

// exports.getTodo = async (req, res, next) => {
//     try {
//         const todo = await Todo.find();
//         res.json(todo);
//     } catch (error) {
//         next(error);
//     }
// }

// exports.updateTodo = async (req, res, next) => {
//     try {
//         const todo = await Todo.findByIdAndUpdate(
//             req.params.id,
//             req.body, 
//             { new: true }
//         )

//         if(!todo){
//             return res.status(404).json("Todo not found");
//         }
//         res.json({message: "Todo updated"});
//     }
//     catch(error){
//         next(error);
//     }
// }

// exports.deleteTodo = async (req, res, next) => {
//     try {
//         const todo = await Todo.findByIdAndDelete(req.params.id)
//         if(!todo){
//             return res.status(404).json("Todo not found");
//         }
//         res.json({message: 'Todo deleted'});
//     }
//     catch(error){
//         next(error);
//     }
// }