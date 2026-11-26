#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

/// Вычисление стандартной контрольной суммы IEEE 802.3 CRC-32
/// над буфером в линейной памяти WebAssembly [ptr .. ptr + len].
#[no_mangle]
pub unsafe extern "C" fn crc32(ptr: *const u8, len: usize) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    let mut i: usize = 0;
    while i < len {
        let byte = *ptr.add(i) as u32;
        crc ^= byte;
        let mut bit = 0;
        while bit < 8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
            bit += 1;
        }
        i += 1;
    }
    !crc
}

/// Один шаг быстрого генератора псевдослучайных чисел xorshift32.
#[no_mangle]
pub extern "C" fn xorshift32(mut state: u32) -> u32 {
    if state == 0 {
        state = 0x9E37_79B9;
    }
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    state
}

/// Перемешивание массива индексов u32 по алгоритму Фишера-Йетса на месте.
#[no_mangle]
pub unsafe extern "C" fn shuffle_indices(ptr: *mut u32, count: usize, mut seed: u32) {
    if count <= 1 {
        return;
    }
    if seed == 0 {
        seed = 0xA5A5_5A5A;
    }
    let mut i = count - 1;
    while i > 0 {
        seed = xorshift32(seed);
        let j = (seed as usize) % (i + 1);
        let a = *ptr.add(i);
        let b = *ptr.add(j);
        *ptr.add(i) = b;
        *ptr.add(j) = a;
        i -= 1;
    }
}
