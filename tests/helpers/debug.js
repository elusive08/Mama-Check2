export const logResponse = (res, label = "Response") => {
  console.log(`\n${label}:`);
  console.log(`Status: ${res.status}`);
  console.log(`Body:`, JSON.stringify(res.body, null, 2));
  return res;
};
