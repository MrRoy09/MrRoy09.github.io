---
title: Control Flow Flattening using LLVM Pass
post_meta:
    date: 10/01/2025
    category: true
    tag: true
categories: 
    - Compilers
tags:
    - LLVM 
    - Obfuscation
---

<style> .article-date { display: none; } </style> 
# Introduction
I've been having fun coding a control flow flattening LLVM pass that obfuscates the control flow of a program. In this blog post, we will discuss control flow flattening, LLVM Passes and how LLVM passes can be used to automate control flow flattening. I also plan on covering other forms of obfuscations using LLVM passes in upcoming blog posts.
# Some basics
Since this is a post on control flow flattening using LLVM passes, I recommend you  familiar with basics of LLVM and LLVM passes. [LLVM for Grad Students](https://www.cs.cornell.edu/~asampson/blog/llvm.html) is an excellent place to start. You can find more introductory LLVM blog posts in the References section.

In short, LLVM passes are used to analyse and transform IR from one form to another. Optimization passes are used to optimize the IR and make it more efficient. Analysis passes like `dot-cfg` are used to analyse the program. We can write custom passes to perform our own optimization/obfuscation/analysis and that is exactly what we are going to do. 

Note: The entire code for this project can be found here https://github.com/MrRoy09/llvm-control-flow-flatten

# Control Flow Flattening
From Wikipedia: 
> Control flow (or flow of control) is the order in which individual statements, instructions or function calls of an imperative program are executed or evaluated.

Control flow analysis, in reverse engineering, is vital to understanding the behaviour of program. In a program, the complexity of control flow is usually linear with respect to the number of instruction blocks. Hence,static analysis can reveal a lot about the control flow of a program. Control flow obfuscation seeks to increase the complexity of control flow and make it harder to statically analyse and determine the control flow of the program. To achieve this, we will be taking the approach outlined in the paper

[OBFUSCATING C++ PROGRAMS VIA CONTROL FLOW FLATTENING](http://ac.inf.elte.hu/Vol_030_2009/003.pdf)

I will describe the algorithm in brief. The basic idea is to encompass all the blocks as `cases` within a `switch` statement (or a switch like construct) and replicate the original control flow using a dispatch variable that controls which block will be executed next. This control variable can be modified at the end of each `case` to control the next `case` to be executed. The simplest example is as follows 

`Entry Block` -> `Block 1` -> `Block 2` can be transformed into `Entry Block` -> `Switch Statement` -> `Block 1` -> `Switch Statement` -> `Block 2`.

Notice how in the transformed example, both `Block 1` and `Block 2` will be at the same level relative to one another (Both are under a `Switch` statement) whereas in the control flow of the original program, `Block 2` resides below `Block 1`. This is why this technique is called control flow flattening as it seeks to bring all the blocks at the same level relative to one another. Another example is as follows. Suppose we have a program 

```cpp
int x;
scanf("%d",&x);
if(x<10){
    printf("Hello");
}
else{
    printf("Bye");
}
```

We can convert this into 

```cpp
int x;
int dispatch=1;
scanf("%d",&x);

while(dispatch){
    switch(dispatch)
    {
        case 1:
          dispatch = 3;
          break;
        case 2:
          if(x<10){
            dispatch = 3;
          }
          else{
            dispatch = 0;
          };
          break;
        case 3:
          printf("Hello");
          dispatch = 0;
          break;
        default:
          printf("Bye");
          dispatch = 0;
          break;
    }
}
```

Using  `LLVM opt` we can generate a graph of the control flow. Here is how the `CFG` (control flow graph) looks for the above two programs

![Unobfuscated CFG](/img/flatten/cfg1.png)
![Obfuscated CFG](/img/flatten/cfg2.png)

Quite the difference, is it not? We can use a LLVM pass to perform this transformation for us!


Note: We will be generating `CFG` to visualize our results later on. You can also take a look at the mentioned paper to see some more examples

# Writing the Pass
Let us start with some boilerplate code 

```cpp
#include "llvm/IR/PassManager.h"
#include "llvm/Support/raw_ostream.h"
#include "llvm/Passes/PassBuilder.h"
#include "llvm/Passes/PassPlugin.h"
#include "llvm/Support/raw_ostream.h"
#include <llvm/IR/Instructions.h>
#include "llvm/Pass.h"
#include <vector>

using namespace llvm;
namespace
{
  class ControlFlowFlatten : public PassInfoMixin<ControlFlowFlatten> // every pass is derived from PassInfoMixin
  {
  public:
    PreservedAnalyses run(Module &M, ModuleAnalysisManager &MAM) // every pass must have a run function which will be called by the pass manager
    {
      for (Function &F : M)
      {
        flattenFunction(F);
      }
      return PreservedAnalyses::none();
    }
  };
}

PassPluginLibraryInfo getPassPluginInfo()
{
  static std::atomic<bool> ONCE_FLAG(false);
  return {LLVM_PLUGIN_API_VERSION, "control-flow-flatten", "0.0.1",
          [](PassBuilder &PB)
          {
            try
            {
              PB.registerPipelineEarlySimplificationEPCallback( // registers the pass to run at the very start of the pipeline
                  [&](ModulePassManager &MPM, OptimizationLevel opt)
                  {
                    if (ONCE_FLAG) // ensures that the pass is registered to only once
                    {
                      return true;
                    }
                    MPM.addPass(ControlFlowFlatten());
                    ONCE_FLAG = true;
                    return true;
                  });
            }
            catch (const std::exception &e)
            {
              outs() << "Error: " << e.what() << "\n";
            }
          }};
};

extern "C" __attribute__((visibility("default"))) LLVM_ATTRIBUTE_WEAK ::llvm::PassPluginLibraryInfo
llvmGetPassPluginInfo()
{
  return getPassPluginInfo();
}
```

The main functionality is in `flattenFunction(F)` which takes a function to flatten as an input. (Very briefly, a Module is a collection of Functions. Functions in turn contain BasicBlocks which in turn contain Instructions). Here is how the `flattenFunction(F)` works

```cpp
bool flattenFunction(Function &F)
    {
      std::vector<BasicBlock *> target_conditionals;
      std::vector<BasicBlock *> BasicBlocks;
      for (auto &BB : F)
      {
        BasicBlocks.push_back(&BB); // push all the basic blocks of this function into a vector
      }

      if (BasicBlocks.size() < 2)
      {
        return 0;
      }

      BasicBlock &entry_block = F.getEntryBlock();

      for (auto *bb : BasicBlocks)
      {
        if (checkIsConditional(bb->getTerminator())) // check if the terminating instruction of the basic block is a conditional branch
        {
          target_conditionals.push_back(bb); 
        }
      }

      if (target_conditionals.size() != 0)
      {
        /* flatten all conditionals basic blocks that have been found starting from 
        the innermost one (in case of nested conditionals)*/
        for (auto i = target_conditionals.rbegin(); i != target_conditionals.rend(); i++)
        {
          flatten_conditional(*i, F); 
        }
      }
      return 1;
    }

```
The helper function `checkIsConditional` is simply
```cpp
   bool checkIsConditional(Instruction *i)
    {
      if (BranchInst *ir = dyn_cast<BranchInst>(i)) // this cast will return 0 if (i) is not a BranchInst
      {
        return ir->isConditional(); // return true if conditional jump
      }
      return 0;
    }
```

Now let us move on to the most important function. `flatten_conditional` is responsible for taking all the blocks that end with a conditional jump and applying the flattening algorithm to them. Here is how it works.

First we want to split the entry blocks into two blocks. This is done using `splitBasicBlockBefore` which creates a new block and inserts it before the specified block. All instructions before the specified instructions are moved to this new block and all instructions including the specified instruction and after it remain in the original block. We will then insert a few instructions in the original block to store and load the dispatch variable. 

```cpp
BasicBlock *temp = conditionalBlock->splitBasicBlockBefore(conditionalBlock->getTerminator()); 
/*temp is created and added before the conditional block. It contains all the instructions prior 
to the last instruction of the conditional block (which is a conditional jump)*/
auto *branchInstruction = dyn_cast<BranchInst>(conditionalBlock->getTerminator()); //conditional block contains only one instruction now i.e conditional jump
ICmpInst *condition = dyn_cast<ICmpInst>(branchInstruction->getCondition()); // get the condition of the conditional jump
Instruction *firstInst = conditionalBlock->getFirstNonPHI();

AllocaInst *switchVar = NULL; 
LoadInst *load = NULL;
switchVar = new AllocaInst(Type::getInt32Ty(F.getContext()), 0, "switchVar", firstInst); //add a new Alloc Inst to allocate the dispatch variable on stack
new StoreInst(ConstantInt::get(Type::getInt32Ty(F.getContext()), 1), switchVar, firstInst); // store initial value 1 in the allocated variable
load = new LoadInst(IntegerType::getInt32Ty(F.getContext()), switchVar, "switchVar", firstInst); // load the allocated variable
```
Here is a visual representation of what we have done 

![Unobfuscated CFG](/img/flatten/demo1.png) ![Obfuscated CFG](/img/flatten/demo1_o.png)

Continuing with 
```cpp
Value *cmp = new ICmpInst(branchInstruction, ICmpInst::ICMP_EQ, load, ConstantInt::get(Type::getInt32Ty(F.getContext()), 0), "cmp");
BasicBlock *trueBlock = branchInstruction->getSuccessor(0); // get the block to be executed if condition is true
BasicBlock *falseBlock = branchInstruction->getSuccessor(1); // get the block to be executed if condition is false
BranchInst::Create(falseBlock, trueBlock, cmp, branchInstruction); // create a new conditional jump based on a cmp condition
branchInstruction->removeFromParent(); // remove the original conditional jump
```
This sets up the `while(dispatch)` loop by jumping to the `falseBlock` whenever `switch_var` is equal to zero.

Lets start constructing a block for `switch` and `switch cases` now.
```cpp
BasicBlock *switch_case_3 = trueBlock; // case 3: will execute the true block. Compare with the original code that we manually obfuscated
new StoreInst(ConstantInt::get(Type::getInt32Ty(F.getContext()), 2), switchVar, trueBlock->getTerminator());
BasicBlock *switch_block = BasicBlock::Create(F.getContext(), "switch_statement", &F);
dyn_cast<BranchInst>(conditionalBlock->getTerminator())->setSuccessor(1, switch_block);
/*
create a SwitcInst. Default case is the falseBlock, condition is the load instruction created above that loads the dispatch variable
*/
SwitchInst *switchI = SwitchInst::Create(load, falseBlock, 2, switch_block); 

/*we want to ensure that the StoreInst is executed only once but the LoadInst needs to be executed every loop
Hence we split the block on the load instruction */
BasicBlock *newconditionalBlock = conditionalBlock->splitBasicBlockBefore(load);
//newconditionalBlock is Block6 in the below figure. Conditional Block is block 8
``` 
Lets take a look at what we have done here
![Obfuscated CFG](/img/flatten/demo2_o.png) Looks good! The default is jumping to the false block i.e `printf("bye")`

Although we don't have any loops in our example, but if we did, we would notice that the loops are still pointing back to Block 6. This would cause the `StoreInst` to store `1` in the dispatch variable and hence only `case:1` will be executed. We need to update the `predecessors` of Block 6 to instead point to Block 7.

```cpp
for (auto *pred : predecessors(newconditionalBlock))
{
  //all except the entry block should point to Block 8 instead of Block 6
    if (pred != (*predecessors(newconditionalBlock).begin()))
    {
      Instruction *terminator = pred->getTerminator();
      for (unsigned i = 0; i < terminator->getNumSuccessors(); i++)
      {
        if (terminator->getSuccessor(i) == newconditionalBlock)
        {
          terminator->setSuccessor(i, conditionalBlock);
        }
      }
    }
}
```

We can now create the `case 2` and `case 1` as follows
```cpp
BasicBlock *switch_case_1 = BasicBlock::Create(F.getContext(), "case_1", &F);
new StoreInst(ConstantInt::get(F.getContext(), APInt(32, 2)), switchVar, switch_case_1);
BranchInst::Create(conditionalBlock, switch_case_1); // jump back to conditional block

BasicBlock *switch_case_2 = BasicBlock::Create(F.getContext(), "case_2", &F);
BasicBlock *thenBlock = BasicBlock::Create(F.getContext(), "case_2_then", &F);
new StoreInst(ConstantInt::get(F.getContext(), APInt(32, 3)), switchVar, thenBlock);
BranchInst::Create(conditionalBlock, thenBlock); // true block will jump back to conditional block
BasicBlock *elseBlock = BasicBlock::Create(F.getContext(), "case_2_else", &F);
new StoreInst(ConstantInt::get(F.getContext(), APInt(32, 0)), switchVar, elseBlock);
BranchInst::Create(conditionalBlock, elseBlock); // false block will also jump back to conditional block
ICmpInst *condition_replicate = (ICmpInst *)condition->clone(); // replicate the condition from the original code
IRBuilder<> Builder(switch_case_2);
Builder.Insert(condition_replicate);
BranchInst::Create(thenBlock, elseBlock, condition_replicate, switch_case_2); // jump to thenBlock or elseBlock depending on the condition
```

Here is how that looks. See if you can identify all the blocks we have just added.
![Obfuscated cfg](/img/flatten/demo3_o.png)

And we are at the final step! All that remains is to add these three switch cases to the switch statement as follows
```cpp
switchI->addCase(ConstantInt::get(F.getContext(), APInt(32, 1)), switch_case_1);
switchI->addCase(ConstantInt::get(F.getContext(), APInt(32, 2)), switch_case_2);
switchI->addCase(ConstantInt::get(F.getContext(), APInt(32, 3)), switch_case_3);
```

The final result looks like this 
![Obfuscated cfg](/img/flatten/demo4_o.png)

# Results
Let us obfuscate and decompile some simple programs using `Ida` and see how they look like

Code: 
```cpp
#include <stdio.h>

int main()
{
    int x;
    scanf("%d", &x);
    while(x<100){
        printf("%d\n",x);
        x++;
    }
    return 0;
}
```
![Obfuscated while loop](/img/flatten/demo5.png)

Code:
```cpp
#include <stdio.h>

int main()
{
    int x;
    scanf("%d", &x);
    while (x < 100)
    {
        if (x % 2 == 0)
        {
            printf("even\n");
        }
        else if (x % 2 != 0)
        {
            printf("odd\n");
        }
        else{
            printf("not possible\n");
        }
        x++;
    }
    return 0;
}
```
![Obfuscated while loop](/img/flatten/demo6.png)

Code:
```cpp
#include <stdio.h>

int main()
{
    int x;
    scanf("%d", &x);
    while (x < 100)
    {
        printf("The number is %d\n",x);
        if (x % 2 == 0)
        {
            printf("Divisible by 2\n");
        }
        if(x %3 ==0){
            printf("Divisible by 3\n");
        }
        if(x % 5 ==0){
            printf("Divisible by 5\n");
        }
        printf("\n");
        x++;
    }
    return 0;
}
```
![Obfuscated while loop](/img/flatten/demo7.png)

# Conclusion
The complexity of the control flow increases non-linearly with the number of conditionals and control structures. This pass effectively obfuscates `for`, `while`, `if-else`, and `if-if` blocks. While it doesn't directly handle switch statements, I've included a complementary pass in the GitHub repo that converts switch statements to `if-else` chains, which can be run before the flatten.so pass.

In the end, we've seen how a relatively simple LLVM pass (~100 lines of code) can significantly complicate control flow analysis, even for basic loops. To make any meaningful analysis possible, we would need to reverse the obfuscation algorithm and reconstruct a viable control flow graph - no small task.

The code for this project is available in my GitHub repo. Stay tuned for the next post in this series where we'll explore more LLVM-based obfuscation techniques!

# References 
[LLVM for grad students](https://www.cs.cornell.edu/~asampson/blog/llvm.html)
[Learning LLVM part 1 by 0xSh4dy](https://sh4dy.com/2024/06/29/learning_llvm_01/)
[Control Flow Flattening: How to build your own](https://www.lodsb.com/control-flow-flattening-how-to-build-your-own)
[LLVM based obfuscator source code](https://github.com/obfuscator-llvm/obfuscator)







