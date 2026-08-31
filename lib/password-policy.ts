export function passwordProblem(value: unknown) {
  if (
    typeof value !== 'string' ||
    Array.from(value).length < 15 ||
    Array.from(value).length > 128
  )
    return '비밀번호는 15~128자로 입력해 주세요. 기억하기 쉬운 긴 문장도 사용할 수 있습니다.';
  if (
    /^(.)\1+$/u.test(value) ||
    [
      '123456789012345',
      '1234567890123456',
      'passwordpassword',
      'qwertyuiopasdfgh',
    ].includes(value.toLowerCase())
  )
    return '반복 문자나 쉽게 추측할 수 있는 비밀번호는 사용할 수 없습니다.';
  return '';
}
