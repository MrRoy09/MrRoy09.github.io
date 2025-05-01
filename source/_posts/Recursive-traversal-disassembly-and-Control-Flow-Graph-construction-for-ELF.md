---
title: CFG Construction via Recursive Disassembly of ELF Binaries
date: 2025-04-30 05:59:37
category: Reverse Engineering
tags:
- Disassembler
- Control flow graph
---

# Introduction
In this post, we will discuss ELF binaries, Disassembly algorithms and Control flow graph construction. We will create a simple program that can produce the control flow graph of an ELF binary using recursive traversal disassembly.

# A Brief Introduction to Disassembly Algorithms
When given a series of bytes, the simplest method for disassembling them is to process one instruction at a time, moving sequentially through the code. This method is called linear disassembly. However, it comes with a significant flaw: it assumes that all valid instructions are arranged in a strict sequence. In reality, there’s no clear distinction between code and data within the executable section. As a result, data can be interspersed between instructions.

This lack of separation can lead linear disassembly to misinterpret data bytes as code, causing incorrect or incomplete disassembly results. So, how do we overcome this limitation? The answer lies in using recursive traversal for disassembly.

We begin with a known valid instruction—usually the entry point of the binary—and focus on disassembling only those instructions that we are certain will be executed. This allows us to follow the actual control flow of the program, bypassing data or unused instructions. For example, when we encounter an instruction like an unconditional jump (jmp), instead of continuing sequentially, we resume disassembly from the target of the jump. This is because we know with certainty that when the processor encounters the jmp, it will execute the target address (hence the target address must be valid code).

Here is a simple example that will illustrate the difference between linear and recursive traversal disassembly.

``` asm
_start:
    ; Some valid instructions
    mov eax, 1        ; Instruction 1 
    jmp skip          ; Jump to skip label
    
    ; This is data, not code
    db 0xaa, 0xbb, 0xcc   ; Data

skip:
    mov ebx, 2        ; Instruction 2
    int 0x80          ; System call (exit)
```
In this example, linear disassembly will attempt to disassemble the bytes following the jmp skip instruction, including the data (0xaa, 0xbb, 0xcc). However, with recursive traversal, the disassembler will skip over the data and instead focus on disassembling the target of the `jmp skip` instruction, ensuring it follows the correct control flow.

# Control Flow Graph
A Control Flow Graph (CFG) represents the possible execution paths a program might take. Each node in the graph corresponds to a basic block—a sequence of instructions that are executed sequentially, with control entering only at the beginning and exiting only at the end. The edges between nodes indicate how control can flow from one basic block to another. CFG captures the structure of a program's execution and is a valuable tool for analysis.

Consider a simple program as follows:

```c
#include <stdio.h>

int main(){
    int x;
    scanf("%d",&x);

    if(x<10){
        printf("less than 10\n");
    }
    else{
        printf("greater than 10\n");
    }
    return 0;
}
```

The control flow graph of the above program will be as follows
![Control flow graph of main function](/img/CFG_recovery/main1.png)

We will now write a simple program to disassemble functions of an ELF binary to generate control flow graph. We will use capstone engine to decode the instructions for us and then apply recursive traversal to construct a control flow graph.

# ELF Symbols
Before we are able to construct the CFG of a function, we need to be able to locate where it begins. Fortunately, elf files store this information in the form of Symbols. Symbols are entries in a symbol table that represent functions, variables, or other identifiers used during linking or debugging.

An ELF file can contain a maximum of two symbol tables - `.symtab` and `.dynsym`

`.symtab` contains all global symbol references while `.dynsym` contains all the symbols needed for dynamic linking. Note: In stripped binaries, `.symtab` is stripped but `.dynsym` cannot be stripped as it is needed for dynamic linking.

`.symtab` has a corresponding `.strtab` section that contains null terminated name of the symbol. Similarly, `.dynsym` has `.dynstr` section that contains null terminated string name of the symbol.

```c
typedef struct {
    Elf64_Word    st_name;   // Index into the string table
    unsigned char st_info;   // Type and binding attributes
    unsigned char st_other;  // Visibility
    Elf64_Half    st_shndx;  // Section index
    Elf64_Addr    st_value;  // Value of the symbol (e.g., address)
    Elf64_Xword   st_size;   // Size of the symbol
} Elf64_Sym;
```

Here is how we can extract the symbols.

- parse the ELF header to extract the section headers.
- iterate over all section headers to find section headers with type `SHT_SYMTAB` and `SHT_DYNSYM`
- the corresponding `.strtab` or `.dynstr` section can be found using the `sh_link` field of these section headers
- for each symbol, we can index into the string table (index is stored in `st_name` field of symbol struct) to extract name of symbol

Here is a simple helper function to extract symbols 

```cpp

struct ELFFile
{
    std::vector<uint8_t> data;
    uint64_t entry_offset;
    uint64_t dymsym_header_offset;
    uint64_t sym_header_offset;
};

struct Symbol
{
    std::string name;
    uint64_t address;
    uint64_t size;
    uint8_t info;
    uint16_t section_index;
    bool executable;
};

std::vector<Symbol> parseSymbolTable(ELFFile &elfFile)
{
    std::vector<Symbol> symbols;
    
    // Validate ELF file has sufficient size for a header
    if (elfFile.data.size() < sizeof(Elf64_Ehdr))
    {
        std::cerr << "Invalid ELF file." << std::endl;
        return symbols;
    }
    
    // Access the ELF header
    Elf64_Ehdr *header = reinterpret_cast<Elf64_Ehdr *>(elfFile.data.data());
    
    // Locate section headers using the offset from ELF header
    Elf64_Shdr *section_headers = reinterpret_cast<Elf64_Shdr *>(elfFile.data.data() + header->e_shoff);
    
    // Iterate through all section headers
    for (int i = 0; i < header->e_shnum; ++i)
    {
        Elf64_Shdr &sh = section_headers[i];
        
        // Skip sections that aren't symbol tables (static or dynamic)
        if (sh.sh_type != SHT_SYMTAB && sh.sh_type != SHT_DYNSYM)
            continue;
        
        // Get pointer to symbol table data
        const Elf64_Sym *symtab = reinterpret_cast<const Elf64_Sym *>(elfFile.data.data() + sh.sh_offset);
        
        // Calculate number of symbol entries
        size_t symbol_count = sh.sh_size / sizeof(Elf64_Sym);
        
        // Get string table associated with this symbol table
        const Elf64_Shdr &strtab_section = section_headers[sh.sh_link];
        const char *strtab = reinterpret_cast<const char *>(elfFile.data.data() + strtab_section.sh_offset);
        
        // Process each symbol in the table
        for (size_t j = 0; j < symbol_count; ++j)
        {
            const Elf64_Sym &sym = symtab[j];
            
            // Skip symbols with no name
            if (sym.st_name == 0)
                continue;
            
            Symbol s;
            Elf64_Shdr section;
            
            // Extract symbol properties
            s.name = std::string(strtab + sym.st_name);
            s.address = sym.st_value;
            s.size = sym.st_size;
            s.info = sym.st_info;
            s.section_index = sym.st_shndx;
            
            // Determine if symbol is executable (in code section)
            if (s.section_index <= header->e_shnum)
            {
                section = section_headers[s.section_index];
                s.executable = (section.sh_flags & SHF_EXECINSTR) ? 1 : 0;
            }
            
            // Add the symbol to our results
            symbols.push_back(s);
        }
    }
    
    return symbols;
}
```

Now that we have all the symbols, we can begin disassembling all symbols marked as executable.

# Recursive Traversal Disassembly

We consider each function as a series of Blocks. In compiler design, program analysis, and reverse engineering, a basic block is a fundamental concept that represents a sequence of instructions with specific properties:

- Single Entry Point: Execution can only enter the basic block through its first instruction.
- Single Exit Point: Execution can only leave the basic block from its last instruction.
- Sequential Execution: All instructions within a basic block are executed sequentially with no branching in between.

We define the following structs for convenience 

```cpp
struct Instruction
{
    uint64_t address;
    std::string mnemonic;
    std::string op_str;
    cs_detail *details;
    uint32_t id;
};

struct Block
{
    uint64_t start_address;
    uint64_t end_address;
    std::vector<Instruction> instructions;
    std::set<uint64_t> successors;
    std::set<uint64_t> predecessors;
    bool isReturn = false;
};

struct Function
{
    std::string name;
    uint64_t start_address;
    uint64_t end_address;
    std::map<uint64_t, Block> blocks;
};
```

Here is the main function that disassembles each recovered symbol that is marked as executable.

```cpp
void disassemble_symbols(ELFFile &elfFile, std::vector<Symbol> &symbols)
{
    csh handle;
    if (cs_open(CS_ARCH_X86, CS_MODE_64, &handle) != CS_ERR_OK) 
    {
        std::cerr << "Failed to initialize Capstone handle\n";
        return;
    }

    cs_option(handle, CS_OPT_DETAIL, CS_OPT_ON); 

    for (auto &symbol : symbols)
    {
        if (!symbol.executable)
        {
            continue;
        }

        Function function;
        function.name = symbol.name;
        function.start_address = symbol.address;

        disassemble_function_recursive(handle, elfFile, function, symbol.address);

        printf("\nDisassembled %s - Found %zu blocks\n", symbol.name.c_str(), function.blocks.size());

        exportCFGToDOT(function.blocks, function.name+".dot");
    }

    cs_close(&handle);
}
```

`exportCFGToDOT` is just a helper function that converts the recovered CFG into a convenient DOT format. We will discuss it later. The most important function is `disassemble_function_recursive`. Here is how it works.

It maintains two sets:

`pending_addresses`: A worklist of addresses yet to be processed
`processed_block_starts`: Addresses already examined to avoid reprocessing


Starting from the function's **entry point**, we construct the control flow graph (CFG) using a **worklist-based traversal**. The process is as follows:

1. **Initialization**  
   Begin by inserting the function's entry point into the `pending_addresses` set.

2. **Traversal Loop**  
   While `pending_addresses` is not empty:
   
   - Take and remove the first address from the set.
   - If the address has already been processed (i.e., it exists in `processed_block_starts`), skip it.
   - Check if the address lies within an already disassembled block but not at its start:
     - This indicates that control flow is entering the *middle* of a block, which violates CFG rules.
     - In such cases, the original block should be split at that point to form a valid block.  
   - Otherwise, disassemble a new basic block starting at this address using `disassemble_block`.
   - Add the new block to the `function.blocks` map.
   - For each successor of the block:
     - Add it to `pending_addresses` to be processed later.
     - If the successor already exists, update its list of predecessors.

3. **Post-processing**  
   After all reachable blocks are disassembled, perform a second pass:
   
   - Iterate over all blocks and for each block, update the `predecessors` of its successors.
   - This is needed because if we disassemble a block A with successor B. It is possible that successor B has not been disassembled yet and hence we will not be able to add A to the predecessor of B at that point. Hence we do it in the end, when all blocks have been disassembled.

This approach ensures that we capture all reachable instructions in a function and build a valid, complete control flow graph. To visualize a case where we need to split the block, consider the case below:

```cpp
#include <iostream>

int main(){
    int x;
    std::cin>> x;

    if(x>=100){
        std::cout<<"Enter a number less than 100\n";
        return 1;
    }

    while(x<100){  
        std::cout<<"The current iteration is "<<x<<"\n";
        x++;
    }

    return 0;
}
```

This is how the CFG looks without the split block logic 
![Errorneous CFG](/img/CFG_recovery/split_block_ex.png)

Notice how there is an abrupt jump to `0x11f9` which is the second instruction of block `0x11f2`. This means control flow is entering block in the middle. Hence to correct this, we must create a new block starting from `0x11f9`.


# Implementation

```cpp
void disassemble_function_recursive(csh handle, ELFFile &elfFile, Function &function, uint64_t start_address)
{
    // Addresses that need to be processed
    std::set<uint64_t> pending_addresses;
    // Addresses that have already been processed
    std::set<uint64_t> processed_block_starts;
    
    // Initialize with the function's entry point
    pending_addresses.insert(start_address);
    
    // Continue until all reachable code is discovered
    while (!pending_addresses.empty())
    {
        // Get the next address to process
        uint64_t current_address = *pending_addresses.begin();
        pending_addresses.erase(pending_addresses.begin());
        
        // Skip already processed addresses to avoid cycles
        if (processed_block_starts.count(current_address) > 0)
        {
            continue;
        }
        
        // Mark this address as processed
        processed_block_starts.insert(current_address);
        
        // Check if this address is in the middle of an existing block
        bool found_in_block = false;
        uint64_t containing_block_addr;
        for (const auto &[block_addr, block] : function.blocks)
        {
            if (current_address > block.start_address && current_address < block.end_address)
            {
                // We found that this address is inside an existing block
                found_in_block = true;
                containing_block_addr = block_addr;
                break;
            }
        }
        
        if (found_in_block)
        {
            // Split the existing block at current_address
            Block new_block = split_block(function, containing_block_addr, current_address);
            
            // Add the new block to the function
            function.blocks[current_address] = new_block;
            
            // Process all successors of the new block
            for (uint64_t succ : new_block.successors)
            {
                // Update predecessor information for the successor blocks
                if (function.blocks.count(succ) > 0)
                {
                    function.blocks[succ].predecessors.insert(current_address);
                }
                
                // Add successor address to be processed
                pending_addresses.insert(succ);
            }
            continue;
        }
        
        // Disassemble a new block starting at current_address
        Block block = disassemble_block(handle, elfFile, current_address);
        
        // Only add the block if it contains valid instructions
        if (!block.instructions.empty())
        {
            // Add the block to the function
            function.blocks[block.start_address] = block;
            
            // Process all successors of this block
            for (uint64_t succ : block.successors)
            {
                // Update predecessor information for the successor blocks
                if (function.blocks.count(succ) > 0)
                {
                    function.blocks[succ].predecessors.insert(block.start_address);
                }
                
                // Add successor address to be processed
                pending_addresses.insert(succ);
            }
        }
    }
    
    // Final pass to ensure all predecessor information is consistent
    for (auto &[addr, block] : function.blocks)
    {
        for (uint64_t succ : block.successors)
        {
            if (function.blocks.count(succ) > 0)
            {
                function.blocks[succ].predecessors.insert(block.start_address);
            }
        }
    }
}
```

The code for `split_block` is as follows:

```cpp
Block split_block(Function &function, uint64_t block_addr, uint64_t split_address)
{
    //original block
    Block &original_block = function.blocks[block_addr]; 
    Block new_block;

    // create a new block at the point where control flow is entering
    new_block.start_address = split_address;
    //end_address of new block is same as end_address of original block
    new_block.end_address = original_block.end_address;

    // find the instruction index
    size_t split_idx = 0;
    while (split_idx < original_block.instructions.size() &&
           original_block.instructions[split_idx].address < split_address)
    {
        split_idx++;
    }

    // copy all instructions from the splitting point over to the new block
    for (size_t i = split_idx; i < original_block.instructions.size(); i++)
    {
        new_block.instructions.push_back(original_block.instructions[i]);
    }

    // remove all instructions after the splitting point from the original block
    original_block.instructions.resize(split_idx);


    if (!original_block.instructions.empty()) // This should never be empty as we are assuming control flow is entering at a point other than first instruction. Hence one instruction must remain atleast after splitting.
    {
        // update original block end address
        Instruction &last_instr = original_block.instructions.back();
        original_block.end_address = last_instr.address + last_instr.size;
    }
    else
    {
        original_block.end_address = split_address;
    }

    // set successors of new block to be same as successors of original_block
    new_block.successors = original_block.successors;

    //original block only has one successor now -> new_block
    original_block.successors.clear();
    original_block.successors.insert(split_address);

    // new_block as one predecessor -> original_block
    new_block.predecessors.insert(block_addr);

    return new_block;
}
```

The important part is that we only consider successors of a block for disassembly by adding them to `pending_addresses`. This ensures we only disassemble reachable code.

Let us now consider the `disassemble_block` function. It has a much simpler task. Disassemble each instruction sequentially until it encounters a block ending instruction i.e instructions that transfer control flow from one block to another. These include return, jumps, call, hlt etc.

```cpp
Block disassemble_block(csh handle, ELFFile &elfFile, uint64_t start_address)
{
    Block block;
    block.start_address = start_address;
    uint64_t current_offset = start_address;
    cs_insn *insn = nullptr;

    // Begin disassembling instructions one at a time
    while (true)
    {
        // Disassemble a single instruction at current_offset
        size_t count = cs_disasm(handle, elfFile.data.data() + current_offset,
                                 elfFile.data.size() - current_offset, current_offset, 1, &insn);

        // If disassembly fails, exit the block
        if (count == 0)
        {
            std::cerr << "Disassembly error at: 0x" << std::hex << current_offset << std::endl;

            // Set block end if we already have some valid instructions
            if (!block.instructions.empty())
            {
                block.end_address = current_offset;
            }

            return block;
        }

        // Populate custom Instruction structure with disassembled data
        Instruction instr;
        instr.address = insn[0].address;
        instr.mnemonic = insn[0].mnemonic;
        instr.op_str = insn[0].op_str;
        instr.details = insn[0].detail;
        instr.id = insn[0].id;

        // Add the instruction to the block
        block.instructions.push_back(instr);

        // Calculate address of the next instruction
        uint64_t next_address = current_offset + insn[0].size;

        bool is_control_flow = false;

        // Check if instruction is a control flow instruction (jump, call, ret, etc.)
        if (instr.details && instr.details->groups_count > 0)
        {
            for (int i = 0; i < instr.details->groups_count; ++i)
            {
                uint8_t group = instr.details->groups[i];

                if (group == CS_GRP_JUMP || group == CS_GRP_CALL || group == CS_GRP_RET ||
                    group == CS_GRP_INT || instr.mnemonic == "hlt")
                {
                    is_control_flow = true;
                    // Conditional jump: e.g., je, jne, etc.
                    if (group == CS_GRP_JUMP && instr.details->x86.op_count > 0)
                    {
                        cs_x86_op op = instr.details->x86.operands[0];
                        if (op.type == X86_OP_IMM)
                        {
                            block.successors.insert(op.imm);        // jump taken
                            block.successors.insert(next_address);  // fall-through
                        }
                    }
                    // Calls: assume control continues to next instruction after the call
                    else if (group == CS_GRP_CALL && instr.details->x86.op_count > 0)
                    {
                        block.successors.insert(next_address); // we assume function returns and execution continues from next instruction onwards
                        is_control_flow = true;
                    }
                    // Returns: mark block as ending a function
                    else if (group == CS_GRP_RET)
                    {
                        block.isReturn = true;
                    }
                    // Halt: also ends execution
                    else if (instr.mnemonic == "hlt")
                    {
                        block.isReturn = true;
                    }
                }
            }
        }

        // If the current instruction ends control flow, finalize and return the block
        if (is_control_flow)
        {
            block.end_address = next_address;
            cs_free(insn, count);
            return block;
        }

        // Continue to next instruction in the block
        current_offset = next_address;
        cs_free(insn, count);
    }
}
```

# Converting to DOT file format
We have collected all blocks of a function along with its successors and predecessors. For visualization we can convert this to the DOT file format. DOT is a text-based format that defines the structure and appearance of the graph elements nodes, edges, labels, etc. It is used by the Graphviz software. 

Here is an example 

```
digraph CFG {
    node [shape=box fontname="Courier"]; // Set all nodes to box shape and monospaced Courier font

    // Define node A with a label showing two assembly instructions
    "A" [label="A: push rbp\lmov rbp, rsp\l"]; 

    // Define node B with a label showing a call instruction
    "B" [label="B: call C\l"];

    // Define node C with a label showing a return instruction
    "C" [label="C: ret\l"];

    // Define directed edges representing control flow between the nodes
    "A" -> "B";
    "B" -> "C";
}
```

And here is how we take our blocks and convert them to dot format

```cpp
void exportCFGToDOT(const std::map<uint64_t, Block> &blocks, const std::string &filename)
{
    std::ofstream out(filename + ".dot");
    if (!out.is_open())
    {
        std::cerr << "Failed to open file for CFG output.\n";
        return;
    }

    out << "digraph CFG {\n";
    out << "  node [shape=box fontname=\"Courier\"];\n";

    for (const auto &[addr, block] : blocks)
    {
        std::stringstream label;
        //construct a label with all instructions along with their address
        for (const auto &instr : block.instructions)
        {
            label << "0x" << std::hex << instr.address << ": " << instr.mnemonic << " " << instr.op_str << "\\l"; 
        }
        // construct a node along with the label
        out << "  \"" << std::hex << block.start_address << "\" [label=\"" << label.str() << "\"];\n"; 
    }

    // construct edges between block and its successors
    for (const auto &[addr, block] : blocks)
    {
        for (uint64_t succ : block.successors)
        {
            out << "  \"" << std::hex << block.start_address << "\" -> \"" << std::hex << succ << "\";\n"; 
        }
    }

    out << "}\n";
    out.close();
    std::cout << "CFG exported to " << filename << ".dot\n";
}
```

That completes our CFG parser. We can easily convert DOT files to PNG using `dot -Tpng ./file.dot -o ./file.PNG`

 Let us take a look at some results.

# Results

In the previous example, we skipped splitting the block. Let us now look at the correct CFG for the program.

```cpp
#include <iostream>

int main(){
    int x;
    std::cin>> x;

    if(x>=100){
        std::cout<<"Enter a number less than 100\n";
        return 1;
    }

    while(x<100){  
        std::cout<<"The current iteration is "<<x<<"\n";
        x++;
    }

    return 0;
}
```
![Control flow graph of main function](/img/CFG_recovery/main2.png)

The accompanying code for this blog post can be found here <a href="https://github.com/MrRoy09/CFGTracer"> Github Repo For Project</a> 




