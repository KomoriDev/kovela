use astrobox_ng_wit::{FutureReader, astrobox::psys_host::dialog::PickResult, wit_future::FuturePayload};
use std::alloc::{alloc, dealloc, handle_alloc_error};
use std::ptr::NonNull;
use std::task::Poll;

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "$root")]
unsafe extern "C" {
    #[link_name = "[waitable-set-new]"]
    fn waitable_set_new() -> u32;
    #[link_name = "[waitable-set-drop]"]
    fn waitable_set_drop(set: u32);
    #[link_name = "[waitable-join]"]
    fn waitable_join(waitable: u32, set: u32);
    #[link_name = "[waitable-set-poll]"]
    fn waitable_set_poll(set: u32, payload: *mut [u32; 2]) -> u32;
}

#[cfg(not(target_arch = "wasm32"))]
unsafe fn waitable_set_new() -> u32 { unreachable!() }
#[cfg(not(target_arch = "wasm32"))]
unsafe fn waitable_set_drop(_: u32) { unreachable!() }
#[cfg(not(target_arch = "wasm32"))]
unsafe fn waitable_join(_: u32, _: u32) { unreachable!() }
#[cfg(not(target_arch = "wasm32"))]
unsafe fn waitable_set_poll(_: u32, _: *mut [u32; 2]) -> u32 { unreachable!() }

// API3's host expires callbacks after 30s and cannot restart a cancelled future read.
// Keep one read and its canonical buffer alive, polling only its completion event.
pub(crate) struct FilePicker {
    handle: u32,
    buffer: NonNull<u8>,
    waitable_set: u32,
    started: bool,
    complete: bool,
}

impl FilePicker {
    pub(crate) fn new(reader: FutureReader<PickResult>) -> Self {
        let layout = PickResult::VTABLE.layout;
        let buffer = NonNull::new(unsafe { alloc(layout) }).unwrap_or_else(|| handle_alloc_error(layout));
        Self { handle: reader.take_handle(), buffer, waitable_set: 0, started: false, complete: false }
    }

    pub(crate) fn poll(&mut self) -> Poll<PickResult> {
        assert!(!self.complete);
        let code = unsafe {
            if !self.started {
                self.started = true;
                let code = (PickResult::VTABLE.start_read)(self.handle, self.buffer.as_ptr());
                if code == u32::MAX {
                    self.waitable_set = waitable_set_new();
                    waitable_join(self.handle, self.waitable_set);
                    return Poll::Pending;
                }
                code
            } else {
                let mut payload = [0; 2];
                let event = waitable_set_poll(self.waitable_set, &mut payload);
                if event == 0 { return Poll::Pending; }
                assert_eq!(event, 4);
                assert_eq!(payload[0], self.handle);
                payload[1]
            }
        };
        assert_eq!(code, 0);
        self.complete = true;
        Poll::Ready(unsafe { (PickResult::VTABLE.lift)(self.buffer.as_ptr()) })
    }
}

impl Drop for FilePicker {
    fn drop(&mut self) {
        unsafe {
            if self.waitable_set != 0 {
                waitable_join(self.handle, 0);
                waitable_set_drop(self.waitable_set);
            }
            if self.started && !self.complete {
                let code = (PickResult::VTABLE.cancel_read)(self.handle);
                if code == 0 { drop((PickResult::VTABLE.lift)(self.buffer.as_ptr())); }
            }
            dealloc(self.buffer.as_ptr(), PickResult::VTABLE.layout);
            (PickResult::VTABLE.drop_readable)(self.handle);
        }
    }
}
