package com.phoneremote.adapter.windows;

import com.sun.jna.platform.win32.BaseTSD.ULONG_PTR;
import com.sun.jna.platform.win32.User32;
import com.sun.jna.platform.win32.WinDef.DWORD;
import com.sun.jna.platform.win32.WinDef.WORD;
import com.sun.jna.platform.win32.WinUser.INPUT;

public class JnaKeyboard {

    public static final int KEYEVENTF_KEYUP = 0x0002;
    public static final int KEYEVENTF_UNICODE = 0x0004;

    public void typeText(String text) {
        if (text == null || text.isEmpty()) return;
        INPUT[] inputs = (INPUT[]) new INPUT().toArray(text.length() * 2);
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            
            inputs[i * 2].type = new DWORD(INPUT.INPUT_KEYBOARD);
            inputs[i * 2].input.setType("ki");
            inputs[i * 2].input.ki.wScan = new WORD(c);
            inputs[i * 2].input.ki.time = new DWORD(0);
            inputs[i * 2].input.ki.dwExtraInfo = new ULONG_PTR(0);
            inputs[i * 2].input.ki.wVk = new WORD(0);
            inputs[i * 2].input.ki.dwFlags = new DWORD(KEYEVENTF_UNICODE);

            inputs[i * 2 + 1].type = new DWORD(INPUT.INPUT_KEYBOARD);
            inputs[i * 2 + 1].input.setType("ki");
            inputs[i * 2 + 1].input.ki.wScan = new WORD(c);
            inputs[i * 2 + 1].input.ki.time = new DWORD(0);
            inputs[i * 2 + 1].input.ki.dwExtraInfo = new ULONG_PTR(0);
            inputs[i * 2 + 1].input.ki.wVk = new WORD(0);
            inputs[i * 2 + 1].input.ki.dwFlags = new DWORD(KEYEVENTF_UNICODE | KEYEVENTF_KEYUP);
        }
        User32.INSTANCE.SendInput(new DWORD(inputs.length), inputs, inputs[0].size());
    }

    public void keyDown(int vkCode) {
        INPUT input = new INPUT();
        input.type = new DWORD(INPUT.INPUT_KEYBOARD);
        input.input.setType("ki");
        input.input.ki.wVk = new WORD(vkCode);
        input.input.ki.wScan = new WORD(0);
        input.input.ki.time = new DWORD(0);
        input.input.ki.dwExtraInfo = new ULONG_PTR(0);
        input.input.ki.dwFlags = new DWORD(0);

        INPUT[] inputs = (INPUT[]) input.toArray(1);
        User32.INSTANCE.SendInput(new DWORD(1), inputs, inputs[0].size());
    }

    public void keyUp(int vkCode) {
        INPUT input = new INPUT();
        input.type = new DWORD(INPUT.INPUT_KEYBOARD);
        input.input.setType("ki");
        input.input.ki.wVk = new WORD(vkCode);
        input.input.ki.wScan = new WORD(0);
        input.input.ki.time = new DWORD(0);
        input.input.ki.dwExtraInfo = new ULONG_PTR(0);
        input.input.ki.dwFlags = new DWORD(KEYEVENTF_KEYUP);

        INPUT[] inputs = (INPUT[]) input.toArray(1);
        User32.INSTANCE.SendInput(new DWORD(1), inputs, inputs[0].size());
    }

    public void mediaKey(int vkCode) {
        keyDown(vkCode);
        keyUp(vkCode);
    }
}
