import { syncMembership } from "../modules/subscription/service/subscription.service.js";

const requirePro = async (req, res, next) => {
  if (req.user?._id || req.user?.id) {
    req.user.membership = await syncMembership(req.user._id || req.user.id);
  }

  if (req.user?.membership !== "pro") {
    return res.status(403).json({ message: "Pro subscription required" });
  }

  return next();
};

export default requirePro;
