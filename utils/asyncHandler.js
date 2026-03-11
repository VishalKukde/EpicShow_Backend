const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export default asyncHandler;


// A higher-order function that catches async errors automatically and forwards them to your error middleware.

// “Yes, asyncHandler is a higher-order function. It takes an async controller and returns a new function that automatically catches promise rejections and forwards them to Express error middleware.”