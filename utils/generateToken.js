import jwt from "jsonwebtoken";

export const generateAccessToken = (user) => {
    const userId = user?._id || user?.id || user;
    const tokenVersion = Number(user?.tokenVersion ?? 0);
    return jwt.sign(
        { id: userId, tokenVersion },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
    )
}

// to generate the JWT Screat Key :
// node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"


export const generateRefreshToken = (user, expiresIn = "7d") => {
  const userId = user?._id || user?.id || user;
  const tokenVersion = Number(user?.tokenVersion ?? 0);
  return jwt.sign(
    { id: userId, tokenVersion },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn }
  )
}
