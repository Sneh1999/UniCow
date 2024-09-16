export class Mathb {
  static abs(x: bigint): bigint {
    return x < 0 ? -x : x;
  }

  static min(x: bigint, y: bigint): bigint {
    return x < y ? x : y;
  }

  static max(x: bigint, y: bigint): bigint {
    return x > y ? x : y;
  }
}
