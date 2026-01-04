---
title: Control Flow Obfuscation using Vectored Exception Handling
date: 2024-12-29
categories:
  - Explorations
tags:
  - Malware
  - Obfuscation
hide: true
---

# Control Flow Obfuscation using VEH

Recently I came across an interesting malware analysis blog post that analyzed the GULoader malware.\
[Analyzing GuLoader Malware](https://www.elastic.co/security-labs/getting-gooey-with-guloader-downloader)

The most intriguing bit of the malware is its use of Vectored Exception Handling to obfuscate control flow and so I decided to do a little reading on Vectored Exception Handlers and other creative things you can perform using VEH.

# Vectored Exception Handling

From Microsoft official Documentation -

> Vectored exception handlers are an extension to structured exception handling. An application can register a function to watch or handle all exceptions for the application. Vectored handlers are not frame-based, therefore, you can add a handler that will be called regardless of where you are in a call frame. Vectored handlers are called in the order that they were added, after the debugger gets a first chance notification, but before the system begins unwinding the stack.

This is self explanatory. The Vectored Exception Handler functions takes a pointer to the `EXCEPTION_POINTERS` struct defined in `winnt.h`

```c++
typedef struct _EXCEPTION_POINTERS {
  PEXCEPTION_RECORD ExceptionRecord;
  PCONTEXT          ContextRecord;
} EXCEPTION_POINTERS, *PEXCEPTION_POINTERS;
```

`PEXCEPTION_RECORD` stores information related to exception type, exception address etc while `PCONTEXT` stores information related to the state of registers at the time of occurrence of the exception. We can have a lot of fun using these two structs!

# Adding a VEH

Adding a VEH is simple enough. We can use

```
PVOID AddVectoredExceptionHandler(
  ULONG                       First,
  PVECTORED_EXCEPTION_HANDLER Handler
);
```

# Syscalls using Vectored Exception Handling

Around the time I first stumbled upon VEH, `BackdoorCTF` was approaching which is the flagship CTF event of `InfosecIITR`. As a member of the CTF team, I decided to create a challenge based around the concept of VEH. Another interesting blog post described how one can use VEH to make Windows Syscalls.
[Syscalls via Vectored Exception Handling ](https://redops.at/en/blog/syscalls-via-vectored-exception-handling)

I highly recommend checking both the blogs I have mentioned. I will describe the method in brief.
A typical Windows Syscall Stub looks something like

```asm
mov r10,rcx
mov eax, syscall_number
syscall
ret
```

This is assuming the syscall is not hooked by a EDR. There is also a `test` instruction which I am leaving out because it is not relevant to us at the moment. The crucial point is that VEH can replicate this set of instructions, as shown below

```c++
LONG CALLBACK VectoredExceptionHandler(EXCEPTION_POINTERS* ExceptionInfo) {
    if (ExceptionInfo->ExceptionRecord->ExceptionCode == EXCEPTION_ACCESS_VIOLATION && execute) {
        ExceptionInfo->ContextRecord->R10 = ExceptionInfo->ContextRecord->Rcx; // move rcx into r10
        ExceptionInfo->ContextRecord->Rax = ExceptionInfo->ContextRecord->Rip; // mov syscall number (stored in RIP) to RAX
        ExceptionInfo->ContextRecord->Rip = (DWORD64)g_syscall_addr; // point rip to address of syscall instruction
        return EXCEPTION_CONTINUE_EXECUTION; // continue execution -> will make the required syscall and return !!
    }
    return EXCEPTION_CONTINUE_SEARCH;
}
```

If we can ensure that the `RIP` contains the `syscall_number` of the syscall we are interested in, we can trigger an `EXCEPTION_ACCESS_VIOLATION` (because syscall numbers are not valid addresses) and then replicate the Syscall Stub. We then Point RIP to the address of a `Syscall` instruction located within `ntdll.dll`. This syscall instruction can belong to any Ntdll function as we have already moved the syscall number we are interested in into `rax` beforehand using ` ExceptionInfo->ContextRecord->Rax = ExceptionInfo->ContextRecord->Rip;`
(Remember, we setup RIP to store the syscall number. Pretty cool right!)

Another interesting point to note is that in the Call Stack of the application, the Syscall will originate from `Ntdll.dll` (because we are setting RIP to address of a syscall instruction within Ntdll) as opposed to in direct syscall where the the `syscall` originates from within the memory mapping of the application itself. However, note that it will originate from the same address every time which is not as discreet as indirect syscalls.

# Retrieving Syscall Numbers and Address of Syscall Instruction

Syscall numbers change between Windows versions. Hence we need to dynamically retrieve syscall numbers for the functions we are interested in. What better way to do this than use a PE Parser to parse through the Ntdll.dll file on disk and retrieve the syscall number. Since we are parsing the Ntdll.dll file on disk (and not in memory), we don't have to worry about Ntdll functions being hooked by EDR

I decided to write my own parser to get the job done ([Github - Basic PE Parser](https://github.com/MrRoy09/PE_Parser)). I will describe the procedure in brief and you can find the code for this on my Github repo for this Project [(Project Repo)](https://github.com/MrRoy09/VEH_Control_Flow).

- Open the Ntdll.dll File and parse through the headers. Specifically we are interested in the `OptionalHeader` which contains the Address of DataDirectories one of which is the `ExportDirectory` . The `ExportDirectory` contains a list of all the functions exported by the dll.
- Parse through each function in the ExportDirectory and compare the function name with the required function name. Obtain the address for the code for the Desired function
- Go through the opcodes for the required functions until we hit the classic syscall stub. Retrieve the syscall number from the `mov rax, syscall_num` instruction

The process is a bit more naunced and I encourage you to read more about the PE and COFF file format. (PS: It is a good learning experience writing your own PE parser)

Retrieving the address of a syscall instruction is trivial. We can use the offset (in bytes) of any syscall instruction we find within the Ntdll file and convert it to RVA (Relative Virtual Address refers to the address relative to base address of the module when it loaded in memory) of the instruction. Then we can add it to the base address of the Ntdll module loaded. Once the syscall numbers and syscall instruction address are retrieved, we initialize function pointers to point to syscall numbers as follows.

```c++
typedef NTSYSAPI NTSTATUS(NTAPI* _NtWriteVirtualMemory)(
    IN HANDLE ProcessHandle,
    IN PVOID BaseAddress,
    IN PVOID Buffer,
    IN SIZE_T NumberOfBytesToWrite,
    OUT PSIZE_T NumberOfBytesWritten OPTIONAL);

_NtWriteVirtualMemory pNtWriteVirtualMemory;
INT16 SysNtWriteVirtualMem = syscall_num(4121089429, parser, fileData);
pNtWriteVirtualMemory = (_NtWriteVirtualMemory)SysNtWriteVirtualMem;
```

where syscall_num is the function responsible for retrieving syscall number and 4121089429 is simply the hash (custom hash algo) of `NtWriteVirtualMemory`. I used function name hashing to make the process more discreet. The parser also computes the hash of each function in the export directory and compares it with the provided hash. This way we don't have to use any strings to get the required functions.

Now if one calls the `pNtWriteVirtualMemory` function, it will raise `EXCEPTION_ACCESS_VIOLATION` (`RIP` points to `INT16 SysNtWriteVirtualMem` which will moved into RAX by the VEH) which will be handled by the VEH we have registered and the syscall will be made!

# Obfuscating Shellcode Control Flow Using VEH

As can be seen in the aforementioned analysis of GuLoader, the shellcode was observed to be using VEH to obfuscate control flow. It did so by raising various kinds of exceptions and then handling them using VEH to alter the control flow. I decided to implement this in my program by using Syscalls (using the technique mentioned above) to load an obfuscated shellcode.

The shellcode was designed to load all the required modules using PEB traversal and open a socket connection on `localhost:8120`. The server would receive a message, encrypt it and reflect it back to the sender. The aim of the CTF Challenge was to reverse this encryption algo and retrieve the value of the flag.

The shellcode was obfuscated as follows-

- `Ud2` opcode was inserted at random points, followed by the number of bytes to be skipped to reach the next valid instruction. Followed by a spare byte and then a sequence of N random bytes.
- The first byte of the next instruction was Xored with 0xd3
- If (during deobfuscation at runtime) the first byte has already been Xored with 0xd3, the spare byte mentioned above stores 1, otherwise 0. This is because the same `Ud2` opcode can be hit multiple times in a loop or conditional statement and we dont want to xor the first byte of next instruction multiple times.

`Ud2` opcode is used to raise the `EXCEPTION_ILLEGAL_INSTRUCTION` and is functionally similar to
a NOP instruction otherwise. To deobfuscate it, we simply need to read the next byte from where the Exception was raised and we can obtain the number of Random Instructions to skip over and reach next valid instruction. We also xor the first byte of the next instruction with 0xd3 and then set RIP to point to this instruction.

A VEH was setup to handle `Exception_Illegal_Instruction` and deobfuscate the shellcode at runtime

```c++
  if (ExceptionInfo->ExceptionRecord->ExceptionCode == EXCEPTION_ILLEGAL_INSTRUCTION) {
      NTSTATUS status;

      // get address at which exception occured
      uint8_t* rip = (uint8_t*)ExceptionInfo->ContextRecord->Rip;

      BYTE increment = 0;
      SIZE_T bytesRead = 0;
      BYTE check = 0;
      BYTE obfuscated_instruction = 0;
      SIZE_T bytesWritten = 0;

      status = pNtReadVirtualMemory(current_process,
      (PVOID)(rip + 2),
      &increment,
      sizeof(BYTE),
      &bytesRead); // read number of bytes to skip over

      if (!NT_SUCCESS(status)) {
          std::cout << GetLastError() << "\n";
          exit(200);
      }

      status = pNtReadVirtualMemory(current_process,
      (PVOID)(rip + 3),
      &check,
      sizeof(BYTE),
      &bytesRead);  // check if the next valid byte has already been xored

      if (!NT_SUCCESS(status) or bytesRead!=1) {
          std::cout << GetLastError() << "\n";
          exit(200);
      }

      if (check == 0) { // if not xored already, xor the first byte of next valid instruction with 0xd3
          check = 1;
          status = pNtReadVirtualMemory(current_process,
          (PVOID)(rip + increment),
          &obfuscated_instruction,
          sizeof(BYTE),
          &bytesRead);

          if (!NT_SUCCESS(status)) {
              std::cout << GetLastError() << "\n";
              exit(200);
          }

          obfuscated_instruction = obfuscated_instruction ^ 0xd3;

          status = pNtWriteVirtualMemory(current_process,
          (PVOID)(rip + increment),
          &obfuscated_instruction,
          sizeof(BYTE),
          &bytesWritten); // write the deobfuscated first byte at the place of the obfuscated first byte

          if (!NT_SUCCESS(status)) {
              std::cout << GetLastError() << "\n";
              exit(300);
          }
          status = pNtWriteVirtualMemory(current_process,
          (PVOID)(rip + 3),
          &check,
          sizeof(BYTE),
          &bytesWritten); // make sure to set the spare byte to 1 to ensure this valid instruction is not xored again with 0xd3

          if (!NT_SUCCESS(status)) {
              std::cout << GetLastError() << "\n";
              exit(300);
          }
      }

      ExceptionInfo->ContextRecord->Rip = (DWORD64)(rip + increment); // set RIP to point to next valid instruction
      return EXCEPTION_CONTINUE_EXECUTION; //Continue execution flow
  }
  return EXCEPTION_CONTINUE_SEARCH;
```

Note how during the handling of this `EXCEPTION_ILLEGAL_INSTRUCTION`, we also raise `EXCEPTION_ACCESS_VIOLATION` in order to make the syscalls required to read and write virtual memory and deobfuscate shellcode.

# Conclusion

This technique makes it very hard to analyze control flow. To deal with this, we would need to patch the shellcode by replicating the behaviour of the VEH. This can be a very difficult task if the shellcode raises many different kinds of exceptions and performs many different deobfuscations strategies based on the exception raised.

In the case of my challenge, it was enough to merely replace the `Ud2` opcode and following bytes with NOP instructions and then xor the next byte with 0xd3 but you can see that a lot more can be done using VEH.

It should be noted that in my challenge, the shellcode needed to Reside in a page with RWX permissions (alternatively, Call `Ntprotectvirtualmemory` to change memory protections) in order to read and overwrite the first byte of valid instruction. This can be a big red flag but it did not matter for a CTF challenge.

# References

[getting goeey with guloader downloader by elastic.co](https://www.elastic.co/security-labs/getting-gooey-with-guloader-downloader)

[syscalls-via-vectored-exception-handling by redops](https://redops.at/en/blog/syscalls-via-vectored-exception-handling)

https://github.com/MrRoy09/VEH_Control_Flow
